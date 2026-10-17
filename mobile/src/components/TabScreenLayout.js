import { ImageBackground, StyleSheet, Text } from "react-native";
import ScreenHeader from "./ScreenHeader";
import { colors, radius, shadows } from "../theme";
import dashboardBanner from "../assets/dashboard-banner.png";

// The Home look, shared by all three tabs (Home, Validation, Profile) so they
// stay consistent: the light leaf/farm illustration behind the page, the
// AGRISHARE logo and the bell (opens Announcements) at the top. Each screen
// renders its own scrolling content as children.
export default function TabScreenLayout({ navigation, children }) {
  return (
    <ImageBackground source={dashboardBanner} resizeMode="cover" style={styles.screen}>
      <ScreenHeader showLogo onBellPress={() => navigation.navigate("Announcements")} />
      {children}
    </ImageBackground>
  );
}

// Page title under the header (same size/weight as Home's welcome line).
export function PageTitle({ children, style }) {
  return <Text style={[styles.title, style]} accessibilityRole="header">{children}</Text>;
}

// Card surface used on all three tabs.
export const tabCard = {
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.md,
  ...shadows.card,
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { fontSize: 19, fontWeight: "800", color: colors.text, marginBottom: 14 },
});
