import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

/**
 * Stato della pipeline dal server. Polling lento a riposo, serrato durante un
 * run: lo stato vive in SQLite, quindi sopravvive a reload e riapertura.
 */
export function usePipelineStatus() {
  return useQuery({
    queryKey: ['pipeline-status'],
    queryFn: api.pipelineStatus,
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.state === 'running' ? 2_500 : 15_000),
  });
}

export function useStartPipeline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.startPipeline,
    // Anche su 409 lo stato locale va riallineato a quello del server.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['pipeline-status'] }),
  });
}

export function useEraseData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.eraseData,
    // Dopo l'erase ogni dato in cache è stantio: si invalida tutto.
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
