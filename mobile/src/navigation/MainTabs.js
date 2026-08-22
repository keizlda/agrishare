import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import HomeScreen from "../screens/HomeScreen";
import DistributionsScreen from "../screens/DistributionsScreen";
import CommoditiesScreen from "../screens/CommoditiesScreen";
import AnnouncementsScreen from "../screens/AnnouncementsScreen";
import MoreScreen from "../screens/MoreScreen";
import { colors } from "../theme";

const Tab = createBottomTabNavigator();

const ICONS = {
  Home: "home",
  Distributions: "cube",
  Commodities: "star",
  Announcements: "megaphone",
  More: "ellipsis-horizontal-circle",
};

export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: "#9aa89f",
        tabBarStyle: { borderTopColor: colors.border, height: 58, paddingBottom: 8, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: "600" },
        tabBarIcon: ({ color, size, focused }) => (
          <Ionicons name={`${ICONS[route.name]}${focused ? "" : "-outline"}`} size={size - 4} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Distributions" component={DistributionsScreen} />
      <Tab.Screen name="Commodities" component={CommoditiesScreen} />
      <Tab.Screen name="Announcements" component={AnnouncementsScreen} />
      <Tab.Screen name="More" component={MoreScreen} />
    </Tab.Navigator>
  );
}
