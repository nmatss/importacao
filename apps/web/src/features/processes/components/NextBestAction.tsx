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
  const { processId, status, hasFailedValidations, hasLiItems, failedCheckCount } = props;

  // Failed validations take priority over status-based suggestions
  if (hasFailedValidations && status !== 'completed' && status !== 'cancelled') {
    return {
      icon: <AlertTriangle className="h-5 w-5" />,
      title: 'Resolver Divergencias',
      description: `${failedCheckCount ?? 0} verificacao(oes) falharam. Revise os documentos e corrija as inconsistencias.`,
      actionLabel: 'Ver Divergencias',
      link: `/importacao/processos/${processId}`,
      color: 'text-danger-700',
      bgColor: 'bg-danger-50',
      borderColor: 'border-danger-200',
    };
  }

  switch (status) {
    case 'draft':
      return {
        icon: <FileText className="h-5 w-5" />,
        title: 'Aguardando Documentos',
        description:
          'Envie os documentos do processo (Invoice, Packing List, BL) para iniciar a validacao.',
        actionLabel: 'Enviar Documentos',
        link: `/importacao/processos/${processId}`,
        color: 'text-slate-700 dark:text-slate-300',
        bgColor: 'bg-slate-50 dark:bg-slate-900',
        borderColor: 'border-slate-200 dark:border-slate-600',
      };

    case 'documents_received':
      return {
        icon: <CheckCircle className="h-5 w-5" />,
        title: 'Pronto para Validacao',
        description:
          'Os documentos foram recebidos. Execute a validacao automatica para verificar consistencia.',
        actionLabel: 'Iniciar Validacao',
        link: `/importacao/processos/${processId}`,
        color: 'text-primary-700',
        bgColor: 'bg-primary-50',
        borderColor: 'border-primary-200',
      };

    case 'validating':
      return {
        icon: <Clock className="h-5 w-5" />,
        title: 'Validacao em Andamento',
        description:
          'A validacao esta sendo processada. Aguarde o resultado ou revise manualmente.',
        actionLabel: 'Acompanhar',
        link: `/importacao/processos/${processId}`,
        color: 'text-primary-700',
        bgColor: 'bg-primary-50',
        borderColor: 'border-primary-200',
      };

    case 'validated':
      return {
        icon: <FileSpreadsheet className="h-5 w-5" />,
        title: 'Gerar Espelho',
        description: 'Processo validado com sucesso. Gere o espelho para envio a Fenicia.',
        actionLabel: 'Gerar Espelho',
        link: `/importacao/processos/${processId}`,
        color: 'text-primary-700',
        bgColor: 'bg-primary-50',
        borderColor: 'border-primary-200',
      };

    case 'espelho_generated':
      return {
        icon: <Send className="h-5 w-5" />,
        title: 'Enviar para Fenicia',
        description: 'O espelho esta pronto. Envie para a Fenicia para registro da DI.',
        actionLabel: 'Enviar',
        link: `/importacao/processos/${processId}`,
        color: 'text-violet-700',
        bgColor: 'bg-violet-50',
        borderColor: 'border-violet-200',
      };

    case 'sent_to_fenicia':
      if (hasLiItems) {
        return {
          icon: <Package className="h-5 w-5" />,
          title: 'Acompanhar LIs',
          description:
            'Processo enviado para Fenicia com itens que requerem Licenca de Importacao. Acompanhe o status.',
          actionLabel: 'Ver LIs',
          link: '/importacao/lis',
          color: 'text-amber-700',
          bgColor: 'bg-amber-50',
          borderColor: 'border-amber-200',
        };
      }
      return {
        icon: <Clock className="h-5 w-5" />,
        title: 'Aguardando Conclusao',
        description: 'Processo enviado para Fenicia. Aguarde o registro da DI e conclusao.',
        actionLabel: 'Acompanhar',
        link: `/importacao/processos/${processId}`,
        color: 'text-orange-700',
        bgColor: 'bg-orange-50',
        borderColor: 'border-orange-200',
      };

    case 'li_pending':
      return {
        icon: <Package className="h-5 w-5" />,
        title: 'Acompanhar LIs',
        description: 'Licencas de importacao pendentes de deferimento. Monitore os prazos.',
        actionLabel: 'Ver LIs',
        link: '/importacao/lis',
        color: 'text-amber-700',
        bgColor: 'bg-amber-50',
        borderColor: 'border-amber-200',
      };

    case 'completed':
      return {
        icon: <CheckCircle className="h-5 w-5" />,
        title: 'Processo Concluido',
        description: 'Este processo foi finalizado com sucesso.',
        actionLabel: 'Ver Detalhes',
        link: `/importacao/processos/${processId}`,
        color: 'text-emerald-700',
        bgColor: 'bg-emerald-50',
        borderColor: 'border-emerald-200',
      };

    case 'cancelled':
      return {
        icon: <AlertTriangle className="h-5 w-5" />,
        title: 'Processo Cancelado',
        description: 'Este processo foi cancelado.',
        actionLabel: 'Ver Detalhes',
        link: `/importacao/processos/${processId}`,
        color: 'text-danger-700',
        bgColor: 'bg-danger-50',
        borderColor: 'border-danger-200',
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
