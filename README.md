# Ordo

Ordo is an offline Windows desktop app for writing military operation orders (OPORDs). An operation brings the five-paragraph order, its annexes, the units carrying it out, and their tasks and timings into one local workspace.

## Get started

Download and run the Windows x64 installer. The 1.0.0 release includes the unsigned installer, release notes, and SHA-256 checksums. [Download Ordo 1.0.0](https://github.com/shepherrd/Ordo/releases/tag/v1.0.0)

On the **Dashboard**, choose **Create Testify example** to open your own editable copy of a fictional civil-support operation. Start with **Base order** to read the mission, then open **Tasks & objectives** to see who does what and **Timeline** to see when. To write your own plan, choose **Create operation** and select the doctrine you want to use.

## Planning in Ordo

- **Orders and doctrine.** Draft the five base-order paragraphs and choose which annexes, appendices, tabs, and exhibits to include. Use the bundled US Army Orders doctrine or build a custom doctrine with its own product structure and staff responsibilities.
- **Organizations and units.** Build an order of battle (ORBAT) with military symbols and assign it to an organization. Select a unit in the diagram to see its staff, then open **Staff & roles** to edit its positions and personnel. In an operation, add the units you want to task from the ORBAT.
- **Tasks and timing.** Group tasks and objectives by unit, organize the operation into phases, and link events whose timing depends on one another. The operation timeline also shows events from annex timelines. You can choose which annexes to display.
- **Whiteboards.** Sketch a plan with notes, symbols, and planning cards. Save a snapshot to include in an order so the document keeps the version you chose.
- **Review and publication.** Use **Save revision** to record a draft. Compare saved revisions to see what changed, record review decisions, and publish an approved revision. You can keep drafting after publication and return to the order as issued.

## Export and share

In **Export studio**, generate an order in Word, PDF, or HTML. For a communications card, choose the radio nets and PACE plans it should contain.

To reuse a symbol or ORBAT in another workspace, choose **Export → Ordo JSON (reimportable)** under **Symbols & ORBATs**, then **Import JSON** in the receiving workspace. **Doctrines** imports and exports `.ordo-doctrine` packages with their managed assets. To back up the entire local workspace, including its revision history, use **Settings → Back up workspace**.

## Run from source

On Windows with Node.js 24 and npm installed, run the following from the repository root. Initial setup downloads dependencies and Electron.

```powershell
npm ci
npm run setup:desktop
npm run dev
```

Run `npm run lint` and `npm test` to check a change. Run `npm run dist` to build the Windows installer.
