import { useState } from "react";
import {
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius } from "../theme";
import { useAuth } from "../context/AuthContext";
import daSeal from "../assets/da-seal.png";

export default function LoginScreen() {
  const { login } = useAuth();
  const [rsbsaNo, setRsbsaNo] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin() {
    if (!rsbsaNo || !password) {
      setError("Please enter your RSBSA number and password.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await login(rsbsaNo, password);
    } catch (err) {
      setError(err.message === "Invalid login credentials" ? "Incorrect RSBSA number or password." : err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ImageBackground
      source={require("../assets/login-bg.jpg")}
      style={styles.bg}
      resizeMode="cover"
    >
      <View style={styles.overlay} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.logoRow}>
          <Ionicons name="leaf" size={20} color="#fff" />
          <Text style={styles.logo}>AGRISHARE</Text>
        </View>

        <View style={styles.sealRow}>
          <View style={styles.sealBadge}>
            <Image source={daSeal} style={styles.sealImg} />
          </View>
          <View>
            <Text style={styles.sealTitle}>Department of Agriculture</Text>
            <Text style={styles.sealSubtitle}>Municipality of Labangan</Text>
          </View>
        </View>

        <View style={styles.spacer} />

        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Ionicons name="person" size={26} color="#fff" />
          </View>
          <Text style={styles.title}>Welcome Back!</Text>
          <Text style={styles.subtitle}>Login to your AgriShare account</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.inputWrap}>
            <Ionicons name="mail-outline" size={16} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Enter your RSBSA number"
              placeholderTextColor="#9aa89f"
              value={rsbsaNo}
              onChangeText={setRsbsaNo}
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={16} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={[styles.input, { paddingRight: 34 }]}
              placeholder="Enter your password"
              placeholderTextColor="#9aa89f"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword((s) => !s)}>
              <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[styles.loginBtn, submitting && { opacity: 0.6 }]} onPress={handleLogin} disabled={submitting}>
            <Text style={styles.loginBtnText}>{submitting ? "Signing in…" : "Login"}</Text>
          </TouchableOpacity>

          <Text style={styles.footnote}>
            For registered farmers of Barangay Langapud. Contact your FA President if you need help logging in.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15,35,20,0.25)" },
  flex: { flex: 1 },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 56, paddingHorizontal: 20 },
  logo: { color: "#fff", fontSize: 18, fontWeight: "800", letterSpacing: 0.5 },
  sealRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 18, paddingHorizontal: 20 },
  sealBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.6)",
  },
  sealImg: { width: "100%", height: "100%" },
  sealTitle: { color: "#fff", fontSize: 12.5, fontWeight: "700" },
  sealSubtitle: { color: "rgba(255,255,255,0.85)", fontSize: 11, marginTop: 1 },
  spacer: { flex: 1 },
  card: {
    backgroundColor: "#fff",
    borderTopLeftRadius: radius.lg + 4,
    borderTopRightRadius: radius.lg + 4,
    padding: 26,
    paddingBottom: 36,
    alignItems: "center",
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  title: { fontSize: 20, fontWeight: "800", color: colors.primaryDarker },
  subtitle: { fontSize: 12.5, color: colors.textMuted, marginTop: 2, marginBottom: 18 },
  error: { color: colors.red, fontSize: 12, marginBottom: 10 },
  inputWrap: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    marginBottom: 12,
    paddingHorizontal: 10,
  },
  inputIcon: { marginRight: 6 },
  input: { flex: 1, paddingVertical: 11, fontSize: 13.5, color: colors.text },
  eyeBtn: { position: "absolute", right: 10 },
  loginBtn: {
    width: "100%",
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 6,
  },
  loginBtnText: { color: "#fff", fontWeight: "700", fontSize: 14.5 },
  footnote: { fontSize: 10.5, color: colors.textMuted, textAlign: "center", marginTop: 16, lineHeight: 15 },
});
