import { router } from 'expo-router';

/** Closes a form or detail screen. A screen opened directly (no history) goes home instead of failing silently. */
export function leaveScreen(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
