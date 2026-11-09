import { ComposerLauncher } from "./launcher";

export function ComposeEntry(props: { date?: string; compact?: boolean; draftId?: string; calendar?: boolean; openInitially?: boolean }) {
  return <ComposerLauncher {...props} />;
}
