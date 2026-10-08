/**
 * OpenCode self-update UI strings.
 *
 * Evaluated on the extension host (same pattern as terminal/toolbar.ts) and
 * injected into the webview document as `window.__OC_UPDATE_L10N__` by
 * terminal/html.ts. The webview module reads it with English fallbacks.
 *
 * NOTE: zh-CN translations for these keys must be added to
 * l10n/bundle.l10n.zh-cn.json (host packaging owns that file).
 */
import { l10n } from "../../i18n";

export const openCodeUpdateL10nStrings: Record<string, string> = {
  // Pill (version entry) three states
  updateLabel: l10n.t('Update OpenCode'),
  viewProgressLabel: l10n.t('View update progress'),
  updateAvailableTooltip: l10n.t(
    'OpenCode update available: latest {0}',
  ),
  updatingTooltip: l10n.t('Updating OpenCode, click to view progress'),
  retryTooltip: l10n.t('Last update failed. Click to check again'),
  checkTooltip: l10n.t('Click to check for updates'),

  // Method popover
  popoverTitle: l10n.t('Update OpenCode to {0}'),
  hintConfirm: l10n.t('Enter to confirm'),
  hintCancel: l10n.t('Esc to cancel'),
  hintMove: l10n.t('Up and down to switch'),
  cancelLabel: l10n.t('Cancel'),
  methodDetected: l10n.t('Detected install method'),
  methodLastUsed: l10n.t('Last used'),

  // Method one-line explanations
  descCurl: l10n.t('Download and run the official install script to update'),
  descNpm: l10n.t('Update via the npm global package'),
  descPnpm: l10n.t('Update via the pnpm global package'),
  descBun: l10n.t('Update via the bun global package'),
  descYarn: l10n.t('Update via the yarn global package'),
  descVp: l10n.t('Update via the vp tool'),
  descBrew: l10n.t('Update via Homebrew'),

  // Progress / steps (ids aligned with OpenCodeUpdateService)
  progressTitle: l10n.t('Updating OpenCode'),
  stepPrepareTarget: l10n.t('Resolve latest version'),
  stepPrepareLocal: l10n.t('Read installed version'),
  stepExecute: l10n.t('Run update'),
  stepReshim: l10n.t('Sync nvm shim'),
  stepVerify: l10n.t('Verify version'),
  stepRemediateTrust: l10n.t('Apply nvm trust setting'),
  stepRemediateReshim: l10n.t('Run nvm reshim'),

  // Success card
  successTitle: l10n.t('OpenCode updated to {0}'),
  successMessage: l10n.t('Restart the terminal now?'),
  restartNow: l10n.t('Restart now'),
  later: l10n.t('Later'),

  // nvm manual-fallback card / abandon
  blockedTitle: l10n.t('npm update blocked by nvm security policy'),
  abandonUpdate: l10n.t('Abandon update'),
  remediateFailed: l10n.t(
    'Automatic fix did not succeed. Run the following commands in the terminal, then start the update again.',
  ),
  abandonedHint: l10n.t('Update abandoned'),
  gotIt: l10n.t('Got it'),

  // Verify failure / log drawer
  verifyFailedTitle: l10n.t('Update did not take effect, version is still {0}'),
  viewLog: l10n.t('View log'),
  logTitle: l10n.t('Update log'),

  // Copy feedback
  copy: l10n.t('Copy'),
  copied: l10n.t('Copied'),
  copyFailed: l10n.t('Copy failed'),

  // Manual check transients
  checkingUpdates: l10n.t('Checking for updates…'),

  // Misc
  closeLabel: l10n.t('Close'),
  progressShown: l10n.t('Updating OpenCode, progress card shown'),
  stillInProgress: l10n.t('Update still in progress'),
};
