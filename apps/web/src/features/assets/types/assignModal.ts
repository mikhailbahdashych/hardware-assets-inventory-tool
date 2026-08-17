export interface Candidate {
  id: string;
  title: string;
  subtitle: string;
  avatarKey: string;
  square?: true;
}

/**
 * The known half of the pair, as a union rather than four optional props: in
 * pick-employee mode the asset is always known, in pick-asset mode the person
 * is. Optional props would have made every read of them a fallback over a
 * value that is in fact always there.
 */
export type AssignModalProps = { onClose: () => void } & (
  | { mode: 'pick-employee'; assetId: string; assetName: string }
  | { mode: 'pick-asset'; employeeId: string; employeeName: string }
);
