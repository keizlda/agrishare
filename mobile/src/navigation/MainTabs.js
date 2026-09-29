import { StyleSheet, View } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Home, MoreHorizontal, ShieldCheck } from "lucide-react-native";
import HomeScreen from "../screens/HomeScreen";
import ValidationScreen from "../screens/ValidationScreen";
import MoreScreen from "../screens/MoreScreen";
import { colors, radii } from "../theme";
import { MIN_BOTTOM_INSET, TAB_BAR_BASE_HEIGHT } from "../hooks/useTabBarHeight";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const Tab = createBottomTabNavigator();

// Announcements moved off the tab bar — it's already one tap away via the
// bell on Home, so a whole dedicated tab was redundant. Crop Validation
// takes that slot instead, promoted from a card buried in More.
// Distributions and Commodities were removed entirely (mobile no longer
// exposes those pages — web still owns that data).
const ICONS = {
  Home: Home,
  Validation: ShieldCheck,
  More: MoreHorizontal,
};

// Active tab renders in primary green inside the same light-green tint pill
// web uses behind its active nav item; inactive tabs stay muted gray.
function TabIcon({ route, color, focused }) {
  const Icon = ICONS[route.name];
  return (
    <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
      <Icon size={18} color={color} />
    </View>
  );
}

export default function MainTabs() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, MIN_BOTTOM_INSET);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          borderTopColor: colors.border,
          height: TAB_BAR_BASE_HEIGHT + bottomPad,
          paddingBottom: bottomPad,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: "600" },
        tabBarIcon: ({ color, focused }) => <TabIcon route={route} color={color} focused={focused} />,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Validation" component={ValidationScreen} />
      <Tab.Screen name="More" component={MoreScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 34,
    height: 26,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapActive: { backgroundColor: colors.primaryLight },
});
