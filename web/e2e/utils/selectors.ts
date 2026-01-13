/**
 * Centralized selectors for common UI elements
 * Using semantic selectors (roles, labels, text) for flexibility
 */

/**
 * Auth page selectors
 */
export const authSelectors = {
  signInButton: /sign in/i,
  signUpLink: /sign up/i,
  emailInput: /email/i,
  passwordInput: /password/i,
  ssoButton: /sso|saml|single sign/i,
  googleButton: /google/i,
  githubButton: /github/i,
};

/**
 * Navigation selectors
 */
export const navSelectors = {
  projectsLink: /projects/i,
  settingsLink: /settings/i,
  homeLink: /home|dashboard/i,
};

/**
 * Organization selectors
 */
export const orgSelectors = {
  nameInput: /organization name/i,
  slugInput: /slug/i,
  createButton: /create organization/i,
  nextButton: /next|continue/i,
};

/**
 * Project selectors
 */
export const projectSelectors = {
  createButton: /create project|new project/i,
  nameInput: /project name/i,
  submitButton: /create|submit/i,
};

/**
 * Graph/visualization selectors
 */
export const graphSelectors = {
  reactFlowContainer: '[class*="react-flow"]',
  fullscreenButton: /fullscreen|maximize/i,
  helpButton: /help/i,
  emptyState: /no model graph/i,
};

/**
 * Member management selectors
 */
export const memberSelectors = {
  membersHeading: /members/i,
  invitesHeading: /invites/i,
  viewDetails: /view details/i,
  removeFromOrg: /remove from organization/i,
  removeMember: /remove member/i,
  cancel: /cancel/i,
  close: /close/i,
  memberDetails: /member details/i,
};
