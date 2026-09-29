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
import { Eye, EyeOff, Lock, Mail, Sprout, User } from "lucide-react-native";
import { colors, radius } from "../theme";
import { useAuth } from "../context/AuthContext";
import daSeal from "../assets/da-seal.png";

export default function LoginScreen() {
  const { login } = useAuth();
  const [rsbsaNo, setRsbsaNo] = useState(""); // just the last 6 digits
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin() {
    if (rsbsaNo.length < 6 || !password) {
      setError("Please enter the last 6 digits of your RSBSA number and your password.");
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
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
      >
        <View style={styles.logoRow}>
          <Sprout size={20} color="#fff" />
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
            <User size={26} color="#fff" />
          </View>
          <Text style={styles.title}>Welcome Back!</Text>
          <Text style={styles.subtitle}>Login to your AgriShare account</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Text style={styles.fieldLabel}>RSBSA Number</Text>
          <View style={styles.inputWrap}>
            <Mail size={16} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Last 6 digits"
              placeholderTextColor="#9aa89f"
              value={rsbsaNo}
              // A pasted/typed full RSBSA number (with or without hyphens)
              // is quietly reduced to just its last 6 digits as they type —
              // only that part is ever the login ID. No native maxLength
              // here on purpose: RN would clip a pasted full number to its
              // first N characters before this handler ever sees the rest,
              // which is the opposite of what "keep the last 6" needs — the
              // slice below is what actually caps it at 6 digits.
              onChangeText={(text) => setRsbsaNo(text.replace(/\D/g, "").slice(-6))}
              keyboardType="number-pad"
              autoCapitalize="none"
            />
          </View>
          <Text style={styles.helperText}>Enter the last 6 digits of your RSBSA number</Text>

          <View style={styles.inputWrap}>
            <Lock size={16} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={[styles.input, { paddingRight: 34 }]}
              placeholder="Enter your password"
              placeholderTextColor="#9aa89f"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword((s) => !s)}>
              {showPassword ? <EyeOff size={16} color={colors.textMuted} /> : <Eye size={16} color={colors.textMuted} />}
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
  fieldLabel: { width: "100%", fontSize: 11.5, fontWeight: "700", color: colors.text, marginBottom: 4 },
  helperText: { width: "100%", fontSize: 10.5, color: colors.textMuted, marginTop: -8, marginBottom: 12 },
  inputWrap: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    marginBottom: 6,
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
