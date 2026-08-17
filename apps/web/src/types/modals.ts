/**
 * The app-level modals, named once. Each is openable from more than one place
 * (a toolbar button and the command palette, usually), which is why they have
 * an owner instead of a boolean per caller — see providers/ModalProvider.tsx.
 */
export type GlobalModal =
  'palette' | 'newAsset' | 'addEmployee' | 'inviteMember' | 'import' | 'widgets';
