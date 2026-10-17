import { Image, StyleSheet, Text, View } from "react-native";
import ScreenHeader from "./ScreenHeader";
import { colors, radius, shadows } from "../theme";
import leavesArt from "../assets/bg-leaves.png";
import plantArt from "../assets/bg-plant.png";

// The Home look, shared by all three tabs (Home, Validation, Profile) so they
// stay consistent: the sage page with the leaf/plant illustration in the
// corners, the AGRISHARE logo and the bell (opens Announcements) at the top.
// Each screen renders its own scrolling content as children.
//
// The illustration is the web app's dashboard-banner.png cut into two
// transparent corner pieces (white removed, greens slightly deeper), drawn
// at half opacity on the sage background. It's pinned to the edges — the
// leaves top-left under the header, the plant bottom-right above the tab
// bar — behind the content, so cards (opaque) always sit on top of it.
export default function TabScreenLayout({ navigation, children }) {
  return (
    <View style={styles.screen}>
      <ScreenHeader showLogo onBellPress={() => navigation.navigate("Announcements")} />
      <View style={styles.body}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Image source={leavesArt} style={styles.leaves} resizeMode="contain" />
          <Image source={plantArt} style={styles.plant} resizeMode="contain" />
        </View>
        {children}
      </View>
    </View>
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

const ART_OPACITY = 0.5;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  // Tucked into the corner from the left edge; only body-color text (which
  // stays >= 4.9:1 over the art) ever sits near it.
  leaves: { position: "absolute", top: -10, left: -18, width: 140, height: 140, opacity: ART_OPACITY },
  plant: { position: "absolute", right: -12, bottom: 0, width: 176, height: 187, opacity: ART_OPACITY },
  title: { fontSize: 19, fontWeight: "800", color: colors.text, marginBottom: 14 },
});
