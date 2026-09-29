import { useSafeAreaInsets } from "react-native-safe-area-context";

// Base height of the tab bar's own content (icon + label), excluding the
// device's bottom inset. On gesture-nav devices insets.bottom covers the
// gesture line; on 3-button nav (or older devices) it's 0, so a floor keeps
// the bar from looking cramped there.
export const TAB_BAR_BASE_HEIGHT = 58;
export const MIN_BOTTOM_INSET = 8;

// Total on-screen tab bar height (bar content + bottom inset), for screens
// that need to pad their scrollable content so the last item isn't hidden
// behind the bar.
export function useTabBarHeight() {
  const insets = useSafeAreaInsets();
  return TAB_BAR_BASE_HEIGHT + Math.max(insets.bottom, MIN_BOTTOM_INSET);
}
