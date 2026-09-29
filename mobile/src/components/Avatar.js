import { Image, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme";

// Shared avatar-or-fallback rendering for everywhere a farmer's photo shows
// (My Profile, More's profile card). Keyed by `uri` at the call site so a
// fresh upload (new signed URL) forces an immediate remount instead of
// showing a cached image under the old uri.
export default function Avatar({ uri, size = 40, iconSize }) {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return <Image source={{ uri }} style={[styles.base, dim]} />;
  }
  return (
    <View style={[styles.base, styles.fallback, dim]}>
      <Ionicons name="person" size={iconSize ?? Math.round(size * 0.45)} color={colors.primaryDark} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.primaryLight },
  fallback: { alignItems: "center", justifyContent: "center" },
});
