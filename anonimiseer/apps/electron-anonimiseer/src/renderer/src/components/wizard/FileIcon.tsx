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
      return { Icon: FileCode, tone: 'bg-info/10 text-info-foreground dark:text-info' };
    case '.txt':
      return {
        Icon: FileText,
        tone: 'bg-muted text-muted-foreground',
      };
    case '.docx':
      return {
        Icon: FileType,
        tone: 'bg-info/10 text-info-foreground dark:text-info',
      };
    case '.pdf':
      return {
        Icon: FileType,
        tone: 'bg-destructive/10 text-destructive',
      };
    case '.xlsx':
      return {
        Icon: FileSpreadsheet,
        tone: 'bg-success/10 text-success-foreground dark:text-success',
      };
    default:
      return { Icon: FileIcn, tone: 'bg-muted text-muted-foreground' };
  }
}
