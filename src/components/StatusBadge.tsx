import type { PostStatus } from '../api.ts';

export function StatusBadge({ status }: { status: PostStatus }) {
  return <span className={`badge ${status}`}>{status}</span>;
}
