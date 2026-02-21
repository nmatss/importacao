export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ').trim();
}

export function formatCurrency(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
}

export function formatDate(date: string): string {
  const d = new Date(date);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatWeight(kg: number): string {
  return `${kg.toFixed(3)} kg`;
}

export const statusLabels: Record<string, string> = {
  draft: 'Rascunho',
  documents_received: 'Documentos Recebidos',
  validating: 'Validando',
  validated: 'Validado',
  espelho_generated: 'Espelho Gerado',
  sent_to_fenicia: 'Enviado Fenícia',
  li_pending: 'LI Pendente',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

export const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  documents_received: 'bg-yellow-100 text-yellow-700',
  validating: 'bg-blue-100 text-blue-700',
  validated: 'bg-indigo-100 text-indigo-700',
  espelho_generated: 'bg-purple-100 text-purple-700',
  sent_to_fenicia: 'bg-orange-100 text-orange-700',
  li_pending: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-200 text-green-800',
  cancelled: 'bg-red-100 text-red-700',
};
