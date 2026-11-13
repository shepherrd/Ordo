import { refreshPlanningReadiness } from "../domain/planning-progress";
import {
  generateDocumentOrder,
  prepareDocumentOrder,
} from "./document-layout-export";
import {
  generatePlanningOrder,
  preparePlanningOrder,
} from "./planning-card-export";
import { documentStaleness } from "./verify-document-layout";
import { hasRichNarrative } from "../domain/narrative";
import { z } from "zod";
import { generateNarrativeOrder } from "./narrative-export-service";
import {
  generateReadableOrder,
  prepareReadableOrder,
} from "./readable-order-export";
import {
  idSchema,
  operationSchema,
  exportProfileSchema,
  refSchema,
  preferencesSchema,
  type Operation,
  type ExportProfile,
  type ResolvedConfig,
} from "../domain/model";
import { assertOperation, assertExportScope } from "../domain/invariants";
import { createOperation, createExportProfile } from "../domain/factories";
import { validate } from "../validation/engine";
import { project, canonical, projectionVersionFor } from "../export/projection";
import { renderHtml } from "../export/html";
import { renderModularHtml } from "../export/modular-html";
import { templateFor } from "../export/templates";
import type { Repository, Runtime } from "./ports";
import { doctrineCommands, executeDoctrine } from "./doctrine-service";
import { bundledVersion } from "../domain/doctrine-builder";
import { ensureModuleLayout } from "../domain/module-authoring";
import { bindOrganization } from "../domain/unit-profiles";
import { instantiateUnitProfile } from "./workspace-service";
import { generateGraphicalOrder } from "./order-export-service";
import type { GraphicRenderPort } from "./render-contracts";
import { selectedProjectionVersion } from "../export/projection";

export const commandSchema = z.discriminatedUnion("type", [
  ...doctrineCommands,
  z.object({ type: z.literal("create-testify-example") }).strict(),
  z
    .object({ type: z.literal("load"), operationId: idSchema.optional() })
    .strict(),
  z
    .object({
      type: z.literal("create"),
      name: z.string().trim().min(1).max(160),
      demo: z.boolean(),
      configuration: refSchema.optional(),
      unitProfileVersionId: idSchema.optional(),
      initializeTaskOrganization: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("save"),
      operation: operationSchema,
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("save-profile"),
      profile: exportProfileSchema,
      isNew: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("approve"),
      operationId: idSchema,
      expectedRevision: z.number().int().positive(),
      note: z.string().max(4000),
    })
    .strict(),
  z
    .object({
      type: z.literal("publish"),
      operationId: idSchema,
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("generate"),
      operationId: idSchema,
      expectedRevision: z.number().int().positive(),
      profileRef: refSchema,
      publicationId: idSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("preferences"),
      preferences: preferencesSchema,
      operationId: idSchema.optional(),
    })
    .strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export type AppState = ReturnType<OrdoService["load"]> & {
  doctrineUpdate?:
    import("../domain/doctrine-adoption").DoctrineUpdateStatus | null;
  organizationUpdate?:
    import("../domain/organization-adoption").OrganizationUpdateStatus | null;
};
export class OrdoService {
  async executeWithGraphics(
    raw: unknown,
    renderer: GraphicRenderPort,
  ): Promise<AppState> {
    const command = commandSchema.parse(raw);
    if (
      command.type === "generate" &&
      (await generatePlanningOrder(this.repo, this.runtime, command, renderer))
    )
      return this.load(command.operationId);
    if (
      command.type === "generate" &&
      (await generateDocumentOrder(this.repo, this.runtime, command, renderer))
    )
      return this.load(command.operationId);
    if (
      command.type === "generate" &&
      (await generateReadableOrder(this.repo, this.runtime, command, renderer))
    )
      return this.load(command.operationId);
    if (
      command.type === "generate" &&
      (await generateNarrativeOrder(this.repo, this.runtime, command, renderer))
    )
      return this.load(command.operationId);
    if (
      command.type === "generate" &&
      (await generateGraphicalOrder(this.repo, this.runtime, command, renderer))
    )
      return this.load(command.operationId);
    return this.execute(command);
  }
  constructor(
    private repo: Repository,
    private runtime: Runtime,
    private makeDemo: (name: string, config: ResolvedConfig) => Operation,
    private makeTestify?: () => Operation,
  ) {
    for (const config of repo.listConfigurations())
      if (
        !config.doctrine.modules &&
        !repo
          .listDoctrines()
          .some((v) => v.doctrineFamilyId === config.doctrine.id)
      )
        repo.saveDoctrine(bundledVersion(config), null);
  }
  load(operationId?: string) {
    const operations = this.repo.listOperations();
    const op = operationId ? this.repo.getOperation(operationId) : null;
    const config = this.repo.getConfig(op ?? undefined);
    const publications = op ? this.repo.listPublications(op.id) : [];
    const doctrines = this.repo.listDoctrines();
    return {
      selectedDoctrineId: null as string | null,
      operations,
      doctrines,
      assets: this.repo.listAssets(),
      assetPreviews: Object.fromEntries(
        [
          ...[op, ...publications.map((p) => p.snapshot)].flatMap((o) =>
            o?.metadata.documentLayout?.header.logo
              ? [o.metadata.documentLayout.header.logo]
              : [],
          ),
          ...(op?.modules?.assets ?? []),
          ...(config.doctrine.modules?.assets ?? []),
        ]
          .filter((a) => a.mimeType.startsWith("image/"))
          .map((a) => {
            try {
              return [a.assetId, this.repo.assetData(a.assetId)];
            } catch {
              return [a.assetId, ""];
            }
          }),
      ),
      configurations: this.repo
        .listConfigurations()
        .filter(
          (c) =>
            !doctrines.some(
              (v) =>
                v.doctrineFamilyId === c.doctrine.id &&
                v.config.doctrine.version === c.doctrine.version &&
                v.status !== "PUBLISHED",
            ),
        ),
      operation: op,
      cardOrigins: op ? (this.repo.cardOrigins?.(op) ?? {}) : {},
      config,
      profiles: op ? this.repo.listExportProfiles(op.id) : [],
      publications,
      approvals: op ? this.repo.listApprovals(op.id) : [],
      exports: op
        ? this.repo.listExports(op.id).map((e) => ({
            ...e,
            staleness: documentStaleness(e, op),
            supersededSource:
              !!e.sourcePublicationId &&
              publications.some(
                (p) => p.supersedesId === e.sourcePublicationId,
              ),
          }))
        : [],
      findings: op ? this.findings(op, config) : [],
      preferences: this.repo.preferences(),
    };
  }
  execute(input: unknown): AppState {
    const command = commandSchema.parse(input);
    if (command.type.startsWith("doctrine-")) {
      const selectedDoctrineId = executeDoctrine(
        this.repo,
        this.runtime,
        command,
      );
      return { ...this.load(), selectedDoctrineId };
    }
    if (command.type === "load") return this.load(command.operationId);
    if (command.type === "preferences") {
      this.repo.preferences(command.preferences);
      return this.load(command.operationId);
    }
    let opId: string | undefined;
    this.repo.transaction(() => {
      if (command.type === "create-testify-example") {
        if (!this.makeTestify) throw Error("Operation Testify is unavailable");
        opId = this.saveNewOperation(this.makeTestify());
      } else if (command.type === "create") {
        const config = command.configuration
          ? this.repo
              .listConfigurations()
              .find(
                (c) =>
                  c.organization.id === command.configuration!.id &&
                  c.organization.version === command.configuration!.version,
              )
          : this.repo.getConfig();
        if (!config) throw Error("Unknown configuration version");
        if (
          this.repo
            .listDoctrines()
            .some(
              (v) =>
                v.doctrineFamilyId === config.doctrine.id &&
                v.config.doctrine.version === config.doctrine.version &&
                v.status !== "PUBLISHED",
            )
        )
          throw Error(
            "Only published, non-retired doctrine can be selected for a new operation",
          );
        const op = command.demo
          ? this.makeDemo(command.name, config)
          : createOperation(
              command.name,
              config,
              () => this.runtime.id(),
              this.runtime.now(),
            );
        op.name = command.name;
        if (command.unitProfileVersionId) {
          const v = this.repo.getUnitProfile(command.unitProfileVersionId);
          if (v.status !== "PUBLISHED")
            throw Error("Select a published, non-retired Unit Profile");
          op.operationOrganizationBinding = bindOrganization(
            v,
            config,
            this.repo.unitProfileHash(v.unitProfileVersionId),
          );
          if (command.initializeTaskOrganization) {
            if (op.units.length)
              throw Error("Choose either demo units or profile initialization");
            Object.assign(
              op,
              instantiateUnitProfile(
                this.repo,
                op,
                v.unitProfileVersionId,
                true,
                false,
                this.runtime.id(),
                this.runtime.id,
              ),
            );
          }
        } else if (command.initializeTaskOrganization)
          throw Error(
            "Select an organization before initializing Task Organization",
          );
        if (config.doctrine.modules) {
          ensureModuleLayout(
            op,
            config,
            null,
            () => this.runtime.id(),
            this.runtime.now(),
          );
          for (const a of [...op.attachments])
            if (a.doctrineNodeId)
              ensureModuleLayout(
                op,
                config,
                a.doctrineNodeId,
                () => this.runtime.id(),
                this.runtime.now(),
              );
        }
        opId = this.saveNewOperation(op);
      } else if (command.type === "save") {
        const previous = this.repo.getOperation(command.operation.id);
        if (previous.revision !== command.expectedRevision)
          throw Error("Operation changed. Reload before saving.");
        const candidate = command.operation;
        for (const unit of previous.units) {
          const next = candidate.units.find((u) => u.id === unit.id);
          if (
            next &&
            (canonical(unit.sourceOrbat ?? null) !==
              canonical(next.sourceOrbat ?? null) ||
              (unit.symbol &&
                canonical(unit.symbol.base) !== canonical(next.symbol?.base)))
          )
            throw Error(
              "Inherited symbol and ORBAT source provenance cannot be replaced through a planning edit",
            );
          if (
            next &&
            canonical(unit.sourceUnitProfile ?? null) !==
              canonical(next.sourceUnitProfile ?? null)
          )
            throw Error(
              "Unit source provenance cannot be replaced through a planning edit",
            );
        }
        for (const unit of candidate.units)
          if (unit.sourceOrbat && !previous.units.some((u) => u.id === unit.id))
            throw Error("Use the atomic Saved ORBAT import command");
        if (previous.modules && !candidate.modules)
          throw Error(
            "Module authoring cannot be discarded through a planning edit",
          );
        for (const prior of previous.modules?.instances ?? []) {
          const next = candidate.modules?.instances.find(
            (m) => m.moduleInstanceId === prior.moduleInstanceId,
          );
          if (!next && prior.origin === "DOCTRINE")
            throw Error(
              "Remove a doctrine module with an explicit layout override; its content must remain recoverable",
            );
          if (
            next &&
            (next.operationId !== prior.operationId ||
              next.productInstanceId !== prior.productInstanceId ||
              next.origin !== prior.origin ||
              next.moduleDefinitionId !== prior.moduleDefinitionId ||
              next.createdAt !== prior.createdAt ||
              next.localDefinition?.moduleDefinitionId !==
                prior.localDefinition?.moduleDefinitionId ||
              next.localDefinition?.stableKey !==
                prior.localDefinition?.stableKey ||
              next.localDefinition?.moduleType !==
                prior.localDefinition?.moduleType)
          )
            throw Error("Module identity and source binding cannot be changed");
        }
        if (
          candidate.orderId !== previous.orderId ||
          candidate.createdAt !== previous.createdAt ||
          canonical(candidate.doctrineRef) !==
            canonical(previous.doctrineRef) ||
          canonical(candidate.organizationRef) !==
            canonical(previous.organizationRef) ||
          canonical(candidate.echelonRef) !== canonical(previous.echelonRef) ||
          canonical(candidate.operationOrganizationBinding ?? null) !==
            canonical(previous.operationOrganizationBinding ?? null)
        )
          throw Error(
            "Identity and pinned configuration cannot be changed through a planning edit",
          );
        const op = {
          ...candidate,
          revision: previous.revision + 1,
          updatedAt: this.runtime.now(),
        };
        const config = this.repo.getConfig(previous);
        if (
          previous.metadata.statusId ===
          config.doctrine.publicationRequiredStatus
        )
          op.metadata = {
            ...op.metadata,
            statusId: config.doctrine.editingStatus,
          };
        this.repo.saveOperation(
          assertOperation(
            refreshPlanningReadiness(previous, op, config),
            config,
          ),
          previous.revision,
          this.runtime.actor,
        );
        opId = op.id;
      } else if (command.type === "save-profile") {
        const profile = this.saveProfile(command.profile, command.isNew);
        opId = profile.operationId;
      } else if (command.type === "approve") {
        const op = this.repo.getOperation(command.operationId);
        opId = op.id;
        if (op.revision !== command.expectedRevision)
          throw Error(
            "Operation changed. Review the exact revision before approving.",
          );
        const config = this.repo.getConfig(op);
        if (op.metadata.statusId !== config.doctrine.publicationRequiredStatus)
          throw Error(
            "Set the configured acceptable workflow state and save before approving.",
          );
        if (this.findings(op, config).some((f) => f.severity === "error"))
          throw Error("Resolve validation errors before approving.");
        this.repo.insertApproval({
          schemaVersion: 1,
          id: this.runtime.id(),
          operationId: op.id,
          sourceRevision: op.revision,
          actor: this.runtime.actor,
          at: this.runtime.now(),
          note: command.note,
          scope: "OPORD",
          origin: "explicit-approval",
        });
      } else if (command.type === "publish") {
        const op = this.repo.getOperation(command.operationId);
        opId = op.id;
        if (op.revision !== command.expectedRevision)
          throw Error(
            "Operation changed. Review the latest revision before publishing.",
          );
        const config = this.repo.getConfig(op);
        if (!config.doctrine.productTypes.includes("OPORD"))
          throw Error(
            "This doctrine profile does not support OPORD publication",
          );
        if (op.metadata.statusId !== config.doctrine.publicationRequiredStatus)
          throw Error("Approve the planning revision before publishing");
        if (this.findings(op, config).some((f) => f.severity === "error"))
          throw Error("Resolve validation errors before publishing");
        const approval = this.repo
          .listApprovals(op.id)
          .find(
            (a) =>
              a.sourceRevision === op.revision &&
              a.scope === "OPORD" &&
              a.origin === "explicit-approval",
          );
        if (!approval)
          throw Error(
            "Approve this exact revision before publishing. Workflow status alone is not approval.",
          );
        const previous = this.repo.listPublications(op.id)[0];
        if (previous?.sourceRevision === op.revision)
          throw Error("This revision is already published");
        const now = this.runtime.now();
        this.repo.insertPublication({
          schemaVersion: 2,
          id: this.runtime.id(),
          operationId: op.id,
          orderId: op.orderId,
          productType: "OPORD",
          orderNumber: op.orderNumber,
          version: (previous?.version ?? 0) + 1,
          sourceRevision: op.revision,
          publishedAt: now,
          approvalId: approval.id,
          approval: {
            actor: approval.actor,
            at: approval.at,
            note: approval.note,
          },
          snapshot: op,
          config,
          supersedesId: previous?.id ?? null,
        });
      } else if (command.type === "generate") {
        const current = this.repo.getOperation(command.operationId);
        opId = current.id;
        if (current.revision !== command.expectedRevision)
          throw Error("Operation changed. Reload the export preview.");
        const publication = command.publicationId
          ? this.repo
              .listPublications(opId)
              .find((p) => p.id === command.publicationId)
          : null;
        if (command.publicationId && !publication)
          throw Error("Publication not found in this operation");
        const source = publication?.snapshot ?? current,
          config = publication?.config ?? this.repo.getConfig(source);
        const profile = this.repo.getExportProfile(
          command.profileRef.id,
          command.profileRef.version,
        );
        const readable =
          preparePlanningOrder(this.repo, this.runtime, command) ??
          prepareDocumentOrder(this.repo, this.runtime, command) ??
          prepareReadableOrder(this.repo, this.runtime, command);
        if (
          readable &&
          !readable.view.sections.some((s) => "graphic" in s && s.graphic)
        ) {
          readable.retain([]);
          return;
        }
        if (hasRichNarrative(source) || hasRichNarrative(config))
          throw Error(
            "Formatted text requires the asynchronous narrative export renderer",
          );
        if (selectedProjectionVersion(source, profile, config) === 5)
          throw Error(
            "Graphical orders require the asynchronous v5 export renderer",
          );
        const projected = project(source, profile, config),
          now = this.runtime.now();
        const ref = templateFor(profile.product);
        const template = this.repo.getRenderTemplate(ref.id, ref.version);
        const provenance = `${publication ? `${publication.productType} ${publication.orderNumber} v${publication.version}` : "Planning state"} · operation revision ${source.revision} · profile ${profile.name} v${profile.version} · generated ${now} · ${this.runtime.actor}`;
        this.repo.insertExport({
          schemaVersion: 2,
          projectionVersion: projectionVersionFor(source),
          rendererVersion: source.modules ? "html-v2" : "html-v1",
          renderTemplateId: template.id,
          renderTemplateVersion: template.version,
          id: this.runtime.id(),
          operationId: opId,
          sourceRevision: source.revision,
          sourcePublicationId: publication?.id ?? null,
          profile,
          config,
          generatedAt: now,
          actor: this.runtime.actor,
          dependencies: projected.dependencies,
          html: (source.modules ? renderModularHtml : renderHtml)(
            projected.view,
            `${provenance} · projection v${projectionVersionFor(source)} · template ${template.id} v${template.version} · renderer ${source.modules ? "html-v2" : "html-v1"}`,
            template,
            Object.fromEntries(
              [
                ...(source.modules?.assets ?? []),
                ...(config.doctrine.modules?.assets ?? []),
              ]
                .filter((a) => a.mimeType.startsWith("image/"))
                .map((a) => [a.assetId, this.repo.assetData(a.assetId)]),
            ),
          ),
        });
      }
    });
    return this.load(opId);
  }
  private saveNewOperation(op: Operation) {
    this.repo.saveOperation(op, null, this.runtime.actor);
    for (const product of ["opord", "communications-card"] as const)
      this.repo.saveExportProfile(
        createExportProfile(op, product, this.runtime.id()),
      );
    return op.id;
  }
  private saveProfile(candidate: ExportProfile, isNew: boolean) {
    const op = this.repo.getOperation(candidate.operationId);
    assertExportScope(op, candidate);
    if (isNew) {
      const profile = { ...candidate, id: this.runtime.id(), version: 1 };
      this.repo.saveExportProfile(profile);
      return profile;
    }
    const latest = this.repo
      .listExportProfiles(op.id)
      .find((p) => p.id === candidate.id);
    if (!latest || latest.version !== candidate.version)
      throw Error("Export profile changed. Reload before saving.");
    if (canonical(latest) === canonical(candidate)) return latest;
    const profile = { ...candidate, version: latest.version + 1 };
    this.repo.saveExportProfile(profile);
    return profile;
  }
  private findings(op: Operation, config: ResolvedConfig) {
    const findings = validate(op, config);
    for (const asset of [
      ...(op.modules?.assets ?? []),
      ...(config.doctrine.modules?.assets ?? []),
    ])
      try {
        this.repo.verifyAssetReferences([asset]);
      } catch (error) {
        findings.push({
          ruleId: "managed-asset",
          severity: "error",
          category: "Managed assets",
          entityId: asset.assetId,
          field: "asset",
          message: String(error),
          revision: op.revision,
        });
      }
    return findings;
  }
}
