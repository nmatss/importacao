import { Link } from 'react-router-dom';
import {
  FileText,
  CheckCircle,
  FileSpreadsheet,
  Send,
  Clock,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  Package,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────

interface NextBestActionProps {
  processId: string | number;
  status: string;
  hasFailedValidations?: boolean;
  hasLiItems?: boolean;
  failedCheckCount?: number;
  correctionStatus?: string | null;
  className?: string;
}

interface ActionSuggestion {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  link?: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

// ── Logic ────────────────────────────────────────────────────────────────

function getNextAction(props: NextBestActionProps): ActionSuggestion {
  const {
    processId,
    status,
    hasFailedValidations,
    hasLiItems,
    failedCheckCount,
    correctionStatus,
  } = props;

  // Failed validations take priority over status-based suggestions
  if (
    (hasFailedValidations || correctionStatus === 'pending') &&
    status !== 'completed' &&
    status !== 'cancelled'
  ) {
    return {
      icon: <AlertTriangle className="h-5 w-5" />,
      title: 'Resolver correcoes',
      description:
        failedCheckCount && failedCheckCount > 0
          ? `${failedCheckCount} verificacao(oes) falharam. Revise os documentos e corrija as inconsistencias.`
          : 'A validacao terminou com pendencias de correcao. Revise os documentos antes de seguir.',
      actionLabel: 'Ver Divergencias',
      link: `/importacao/processos/${processId}`,
      color: 'text-danger-700 dark:text-danger-300',
      bgColor: 'bg-danger-50 dark:bg-danger-950/30',
      borderColor: 'border-danger-200 dark:border-danger-700/50',
    };
  }

  switch (status) {
    case 'draft':
      return {
        icon: <FileText className="h-5 w-5" />,
        title: 'Aguardando documentos',
        description:
          'Envie os documentos do processo (Invoice, Packing List, BL) para iniciar a validação.',
        actionLabel: 'Enviar documentos',
        link: `/importacao/processos/${processId}`,
        color: 'text-slate-700 dark:text-slate-300',
        bgColor: 'bg-slate-50 dark:bg-slate-900',
        borderColor: 'border-slate-200 dark:border-slate-600',
      };

    case 'documents_received':
      return {
        icon: <CheckCircle className="h-5 w-5" />,
        title: 'Pronto para validação',
        description:
          'Os documentos foram recebidos. Execute a validação automática para verificar consistência.',
        actionLabel: 'Iniciar validação',
        link: `/importacao/processos/${processId}`,
        color: 'text-primary-700 dark:text-primary-300',
        bgColor: 'bg-primary-50 dark:bg-primary-950/30',
        borderColor: 'border-primary-200 dark:border-primary-700/50',
      };

    case 'validating':
      return {
        icon: <Clock className="h-5 w-5" />,
        title: 'Validação em andamento',
        description:
          'A validação está sendo processada. Aguarde o resultado ou revise manualmente.',
        actionLabel: 'Acompanhar',
        link: `/importacao/processos/${processId}`,
        color: 'text-primary-700 dark:text-primary-300',
        bgColor: 'bg-primary-50 dark:bg-primary-950/30',
        borderColor: 'border-primary-200 dark:border-primary-700/50',
      };

    case 'validated':
      return {
        icon: <FileSpreadsheet className="h-5 w-5" />,
        title: 'Gerar espelho',
        description: 'Processo validado com sucesso. Gere o espelho para envio à Fenícia.',
        actionLabel: 'Gerar espelho',
        link: `/importacao/processos/${processId}`,
        color: 'text-primary-700 dark:text-primary-300',
        bgColor: 'bg-primary-50 dark:bg-primary-950/30',
        borderColor: 'border-primary-200 dark:border-primary-700/50',
      };

    case 'espelho_generated':
      return {
        icon: <Send className="h-5 w-5" />,
        title: 'Enviar para Fenícia',
        description: 'O espelho está pronto. Envie para a Fenícia para registro da DI.',
        actionLabel: 'Enviar',
        link: `/importacao/processos/${processId}`,
        color: 'text-violet-700 dark:text-violet-300',
        bgColor: 'bg-violet-50 dark:bg-violet-950/30',
        borderColor: 'border-violet-200 dark:border-violet-700/50',
      };

    case 'sent_to_fenicia':
      if (hasLiItems) {
        return {
          icon: <Package className="h-5 w-5" />,
          title: 'Acompanhar LIs',
          description:
            'Processo enviado para Fenícia com itens que requerem licença de importação. Acompanhe o status.',
          actionLabel: 'Ver LIs',
          link: '/importacao/lis',
          color: 'text-amber-700 dark:text-amber-300',
          bgColor: 'bg-amber-50 dark:bg-amber-950/30',
          borderColor: 'border-amber-200 dark:border-amber-700/50',
        };
      }
      return {
        icon: <Clock className="h-5 w-5" />,
        title: 'Aguardando Conclusao',
        description: 'Processo enviado para Fenicia. Aguarde o registro da DI e conclusao.',
        actionLabel: 'Acompanhar',
        link: `/importacao/processos/${processId}`,
        color: 'text-orange-700 dark:text-orange-300',
        bgColor: 'bg-orange-50 dark:bg-orange-950/30',
        borderColor: 'border-orange-200 dark:border-orange-700/50',
      };

    case 'li_pending':
      return {
        icon: <Package className="h-5 w-5" />,
        title: 'Acompanhar LIs',
        description: 'Licencas de importacao pendentes de deferimento. Monitore os prazos.',
        actionLabel: 'Ver LIs',
        link: '/importacao/lis',
        color: 'text-amber-700 dark:text-amber-300',
        bgColor: 'bg-amber-50 dark:bg-amber-950/30',
        borderColor: 'border-amber-200 dark:border-amber-700/50',
      };

    case 'completed':
      return {
        icon: <CheckCircle className="h-5 w-5" />,
        title: 'Processo Concluido',
        description: 'Este processo foi finalizado com sucesso.',
        actionLabel: 'Ver Detalhes',
        link: `/importacao/processos/${processId}`,
        color: 'text-emerald-700 dark:text-emerald-300',
        bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
        borderColor: 'border-emerald-200 dark:border-emerald-700/50',
      };

    case 'cancelled':
      return {
        icon: <AlertTriangle className="h-5 w-5" />,
        title: 'Processo Cancelado',
        description: 'Este processo foi cancelado.',
        actionLabel: 'Ver Detalhes',
        link: `/importacao/processos/${processId}`,
        color: 'text-danger-700 dark:text-danger-300',
        bgColor: 'bg-danger-50 dark:bg-danger-950/30',
        borderColor: 'border-danger-200 dark:border-danger-700/50',
      };

    default:
      return {
        icon: <Clock className="h-5 w-5" />,
        title: 'Status Desconhecido',
        description: 'Verifique o processo para mais informacoes.',
        actionLabel: 'Ver Processo',
        link: `/importacao/processos/${processId}`,
        color: 'text-slate-700 dark:text-slate-300',
        bgColor: 'bg-slate-50 dark:bg-slate-900',
        borderColor: 'border-slate-200 dark:border-slate-600',
      };
  }
}

// ── Component ────────────────────────────────────────────────────────────

export function NextBestAction(props: NextBestActionProps) {
  const action = getNextAction(props);

  return (
    <div
      className={cn('rounded-xl border p-4', action.bgColor, action.borderColor, props.className)}
    >
      <div className="flex items-start gap-3">
        <div className={cn('mt-0.5 flex-shrink-0', action.color)}>
          <Sparkles className="h-4 w-4 mb-1 text-amber-500" />
          {action.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn('text-sm font-semibold', action.color)}>{action.title}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{action.description}</p>

          {action.link && (
            <Link
              to={action.link}
              className={cn(
                'inline-flex items-center gap-1.5 mt-3 text-sm font-medium transition-colors',
                action.color,
                'hover:opacity-80',
              )}
            >
              {action.actionLabel}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
