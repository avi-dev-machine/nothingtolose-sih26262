export enum ApplicationState {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  UNDER_SCRUTINY = 'UNDER_SCRUTINY',
  DEFICIENCY_RAISED = 'DEFICIENCY_RAISED',
  RESUBMITTED = 'RESUBMITTED',
  SCRUTINY_CLEARED = 'SCRUTINY_CLEARED',
  EVC_REQUIRED = 'EVC_REQUIRED',
  EVC_SCHEDULED = 'EVC_SCHEDULED',
  EVC_IN_PROGRESS = 'EVC_IN_PROGRESS',
  EVC_COMPLETED = 'EVC_COMPLETED',
  COMMITTEE_REVIEW = 'COMMITTEE_REVIEW',
  FINAL_DECISION = 'FINAL_DECISION',
  APPROVED = 'APPROVED',
  APPROVED_WITH_CONDITIONS = 'APPROVED_WITH_CONDITIONS',
  REJECTED = 'REJECTED',
  COMPLIANCE_REQUIRED = 'COMPLIANCE_REQUIRED',
}

export const APPLICATION_STATES = Object.values(ApplicationState) as [
  ApplicationState,
  ...ApplicationState[],
];

export enum WorkflowTrack {
  TRACK_A = 'TRACK_A', // Only Scrutiny
  TRACK_B = 'TRACK_B', // Scrutiny + EVC
  TRACK_C = 'TRACK_C', // EVC + SAC/SHC
  TRACK_D = 'TRACK_D', // Only EVC
}

export const WORKFLOW_TRACKS = Object.values(WorkflowTrack) as [
  WorkflowTrack,
  ...WorkflowTrack[],
];

export const TRACK_DESCRIPTIONS: Record<WorkflowTrack, string> = {
  [WorkflowTrack.TRACK_A]: 'Track A: Only Scrutiny (Extension of Approval, minor changes)',
  [WorkflowTrack.TRACK_B]: 'Track B: Scrutiny + EVC (New courses, intake increase, change of site)',
  [WorkflowTrack.TRACK_C]: 'Track C: EVC + SAC/SHC (New technical institutions, university status)',
  [WorkflowTrack.TRACK_D]: 'Track D: Only EVC (Surprise/Compliance verification visit)',
};
