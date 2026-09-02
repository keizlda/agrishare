import { ActivityIndicator, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import LoginScreen from "../screens/LoginScreen";
import CropValidationScreen from "../screens/CropValidationScreen";
import RequestsScreen from "../screens/RequestsScreen";
import ProfileScreen from "../screens/ProfileScreen";
import AnnouncementsScreen from "../screens/AnnouncementsScreen";
import InfoScreen from "../screens/InfoScreen";
import ChangePasswordScreen from "../screens/ChangePasswordScreen";
import NotificationSettingsScreen from "../screens/NotificationSettingsScreen";
import LanguageScreen from "../screens/LanguageScreen";
import MainTabs from "./MainTabs";
import { useAuth } from "../context/AuthContext";
import { colors } from "../theme";

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const { isAuthenticated, initializing } = useAuth();

  if (initializing) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {isAuthenticated ? (
        <>
          <Stack.Screen name="MainTabs" component={MainTabs} />
          <Stack.Screen name="CropValidation" component={CropValidationScreen} options={{ presentation: "modal" }} />
          <Stack.Screen name="Requests" component={RequestsScreen} options={{ presentation: "modal" }} />
          <Stack.Screen name="Profile" component={ProfileScreen} options={{ presentation: "modal" }} />
          {/* No longer a bottom tab — reached from Home's bell instead. */}
          <Stack.Screen name="Announcements" component={AnnouncementsScreen} options={{ presentation: "modal" }} />
          <Stack.Screen name="Info" component={InfoScreen} options={{ presentation: "modal" }} />
          <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ presentation: "modal" }} />
          <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} options={{ presentation: "modal" }} />
          <Stack.Screen name="Language" component={LanguageScreen} options={{ presentation: "modal" }} />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
}
