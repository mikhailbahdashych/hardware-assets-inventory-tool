export interface InviteMemberModalProps {
  /** The signed-in member's role — decides whether Admin is on offer. */
  viewerRole: string;
  onClose: () => void;
}
