import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/context/AuthContext";
import ErrorBoundary from "./src/components/ErrorBoundary";
import RootNavigator from "./src/navigation/RootNavigator";

export default function App() {
  return (
    <SafeAreaProvider>
      {/* A screen that crashes shows "Something went wrong" + Reload, not a blank screen. */}
      <ErrorBoundary>
        <AuthProvider>
          <NavigationContainer>
            <StatusBar style="dark" />
            <RootNavigator />
          </NavigationContainer>
        </AuthProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
