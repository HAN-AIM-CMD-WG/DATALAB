import { FileText, FileType, FileSpreadsheet, FileCode, File as FileIcn } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Typed bestandsicoon op basis van extensie. We gebruiken bewust geen
 * emoji: het moet consistent blijven op alle platforms.
 */
export function FileIcon({ extension }: { extension: string }): JSX.Element {
  const ext = extension.toLowerCase();
  const { Icon, tone } = pick(ext);
  return (
    <span
      className={cn(
        'flex h-8 w-8 flex-none items-center justify-center rounded-md',
        tone
      )}
      aria-hidden
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

function pick(ext: string): {
  Icon: typeof FileIcn;
  tone: string;
} {
  switch (ext) {
    case '.md':
      return { Icon: FileCode, tone: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' };
    case '.txt':
      return {
        Icon: FileText,
        tone: 'bg-muted text-muted-foreground',
      };
    case '.docx':
      return {
        Icon: FileType,
        tone: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
      };
    case '.pdf':
      return {
        Icon: FileType,
        tone: 'bg-red-500/10 text-red-700 dark:text-red-300',
      };
    case '.xlsx':
      return {
        Icon: FileSpreadsheet,
        tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      };
    default:
      return { Icon: FileIcn, tone: 'bg-muted text-muted-foreground' };
  }
}
