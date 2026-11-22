import { ActivityIndicator, View } from "react-native";
import ErrorBanner from "../components/ui/ErrorBanner";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import LoginScreen from "../screens/LoginScreen";
import CropValidationScreen from "../screens/CropValidationScreen";
import RequestsScreen from "../screens/RequestsScreen";
import HarvestScreen from "../screens/HarvestScreen";
import HarvestReportScreen from "../screens/HarvestReportScreen";
import AnnouncementsScreen from "../screens/AnnouncementsScreen";
import MyDistributionsScreen from "../screens/MyDistributionsScreen";
import ChangePasswordScreen from "../screens/ChangePasswordScreen";
import MainTabs from "./MainTabs";
import { useAuth } from "../context/AuthContext";
import { colors } from "../theme";

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const { isAuthenticated, initializing, bootError, retryRestore } = useAuth();

  if (initializing) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Signed in earlier, but the account couldn't load (offline, server
  // problem): stay signed in and offer a retry rather than showing Login.
  if (bootError) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: colors.bg }}>
        <ErrorBanner message={bootError} onRetry={retryRestore} />
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
          <Stack.Screen name="Harvest" component={HarvestScreen} options={{ presentation: "modal" }} />
          <Stack.Screen name="HarvestReport" component={HarvestReportScreen} options={{ presentation: "modal" }} />
          {/* No longer a bottom tab — reached from Home's bell instead. */}
          <Stack.Screen name="Announcements" component={AnnouncementsScreen} options={{ presentation: "modal" }} />
          <Stack.Screen name="MyDistributions" component={MyDistributionsScreen} options={{ presentation: "modal" }} />
          <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ presentation: "modal" }} />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
}
