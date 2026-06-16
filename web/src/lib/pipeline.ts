import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Bucket } from '../api/types';

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

/**
 * Stato del job di enrichment progressivo. Polling serrato mentre è running,
 * fermo a riposo. Lo stato vive in SQLite (sopravvive a reload).
 */
export function useEnrichmentStatus() {
  return useQuery({
    queryKey: ['enrichment-status'],
    queryFn: api.enrichmentStatus,
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.state === 'running' ? 2_000 : false),
  });
}

/** Avvia l'enrichment (intero segmento, bucket o singolo contatto). */
export function useStartEnrichment(date: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { bucket?: Bucket; contactId?: number }) => api.enrichSelection(date, body),
    // Anche su 409 lo stato locale va riallineato a quello del server.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['enrichment-status'] }),
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
