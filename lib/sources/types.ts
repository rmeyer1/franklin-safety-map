import type { IngestCursor, SourceCall } from "@/lib/types/domain";

export interface SourceAdapter {
  readonly source: string;
  readonly cursorKey: string;
  poll(cursor: IngestCursor | null): Promise<SourceCall[]>;
}
