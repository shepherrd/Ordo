import {
  searchRequestSchema,
  searchResolveSchema,
  type SearchRequest,
  type SearchResponse,
  type SearchHit,
  type SearchResolve,
  type SearchDocument,
  searchTerms,
} from "../domain/search";
import {
  searchUsageRequestSchema,
  type SearchUsageRequest,
  type SearchUsageResponse,
} from "../domain/search";
export interface SearchRepository {
  query(
    request: SearchRequest,
  ): Omit<SearchResponse, "sequence" | "workspaceGeneration">;
  resolve(request: SearchResolve): SearchDocument | null;
  usage(request: SearchUsageRequest): SearchUsageResponse;
}
export class SearchService {
  constructor(
    private repo: SearchRepository,
    private generation: string,
  ) {}
  usage(input: SearchUsageRequest) {
    return this.repo.usage(searchUsageRequestSchema.parse(input));
  }
  query(input: SearchRequest): SearchResponse {
    const request = searchRequestSchema.parse(input);
    searchTerms(request.query);
    return {
      ...this.repo.query(request),
      sequence: request.sequence,
      workspaceGeneration: this.generation,
    };
  }
  resolve(input: SearchResolve): SearchHit {
    const request = searchResolveSchema.parse(input);
    if (request.workspaceGeneration !== this.generation)
      throw Error(
        "The workspace changed. Search again in the current workspace.",
      );
    const document = this.repo.resolve(request);
    if (!document)
      throw Error("This source is unavailable or changed. Search again.");
    if (document.sourceToken !== request.sourceToken)
      throw Error(
        "This source changed after the search. Search again for its current content.",
      );
    return {
      ...document,
      score: 0,
      excerpt: document.text.slice(0, 240),
      state: "Saved",
    };
  }
}
