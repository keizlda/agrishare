import { StyleSheet, View } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Home, ShieldCheck, User } from "lucide-react-native";
import HomeScreen from "../screens/HomeScreen";
import HarvestScreen from "../screens/HarvestScreen";
import ValidationScreen from "../screens/ValidationScreen";
import ProfileScreen from "../screens/ProfileScreen";
import { colors, radii } from "../theme";
import { MIN_BOTTOM_INSET, TAB_BAR_BASE_HEIGHT } from "../hooks/useTabBarHeight";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const Tab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator();

// Home tab: Home, and Harvest Reports (opened from Home's "Report Harvest"
// card) on top of it, so the tab bar stays and Home stays highlighted.
// Tapping Home again goes back to Home.
function HomeTab() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="HomeMain" component={HomeScreen} />
      <HomeStack.Screen name="Harvest" component={HarvestScreen} />
    </HomeStack.Navigator>
  );
}

// Announcements moved off the tab bar — it's already one tap away via the
// bell on Home, so a whole dedicated tab was redundant. Crop Validation
// takes that slot instead, promoted from a card buried in More.
// Distributions and Commodities were removed entirely (mobile no longer
// exposes those pages — web still owns that data). "More" was later
// renamed to "Profile" and now renders the merged My Profile + settings
// screen directly, rather than a menu that links out to a separate one.
const ICONS = {
  Home: Home,
  Validation: ShieldCheck,
  Profile: User,
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
        // Active label in the darker green so it passes WCAG AA as text.
        tabBarActiveTintColor: colors.primaryDark,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: TAB_BAR_BASE_HEIGHT + bottomPad,
          paddingBottom: bottomPad,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: "600" },
        tabBarIcon: ({ color, focused }) => <TabIcon route={route} color={color} focused={focused} />,
      })}
    >
      <Tab.Screen name="Home" component={HomeTab} />
      <Tab.Screen name="Validation" component={ValidationScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
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
