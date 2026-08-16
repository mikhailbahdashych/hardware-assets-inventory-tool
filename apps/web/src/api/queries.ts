import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from './client';
import type { InviteDetails, Member, Meta } from './types';

/**
 * The query-key catalog. Every cached read is listed here so invalidation
 * after a mutation is a lookup rather than a guess (see api/invalidate.ts).
 */
export const queryKeys = {
  meta: ['meta'] as const,
  me: ['me'] as const,
  invite: (token: string) => ['invite', token] as const,
};

export function useMeta() {
  return useQuery({
    queryKey: queryKeys.meta,
    queryFn: () => apiFetch<Meta>('/meta'),
  });
}

/** Resolves to the signed-in member, or null when nobody is signed in. */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => {
      try {
        const { member } = await apiFetch<{ member: Member }>('/auth/me');
        return member;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
}

export function useInvite(token: string) {
  return useQuery({
    queryKey: queryKeys.invite(token),
    queryFn: () => apiFetch<InviteDetails>(`/auth/invite/${encodeURIComponent(token)}`),
    enabled: token.length > 0,
    retry: false,
  });
}
