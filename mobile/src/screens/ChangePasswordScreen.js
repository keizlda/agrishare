import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import ScreenHeader from "../components/ScreenHeader";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";
import Toast from "../components/ui/Toast";
import { colors, spacing } from "../theme";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

export default function ChangePasswordScreen({ navigation }) {
  const { refreshFarmer } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: "", tone: "success" });

  async function handleSubmit() {
    setError("");
    if (!currentPassword) {
      setError("Please enter your current password.");
      return;
    }
    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;

      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email: userData.user.email,
        password: currentPassword,
      });
      if (verifyErr) throw new Error("Your current password is incorrect.");

      const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
      if (updateErr) throw updateErr;

      // Clears the "using the default password" banner on Home. Non-fatal
      // if it fails — the password itself is already changed either way.
      await supabase.from("profiles").update({ must_change_password: false }).eq("id", userData.user.id).then(
        () => refreshFarmer(),
        () => {},
      );

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setToast({ visible: true, message: "Password updated.", tone: "success" });
    } catch (err) {
      setToast({ visible: true, message: err.message || "Couldn't update password.", tone: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Change Password" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Input
          label="Current Password"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          placeholder="Enter your current password"
          style={styles.field}
        />
        <Input
          label="New Password"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          placeholder="At least 6 characters"
          style={styles.field}
        />
        <Input
          label="Confirm New Password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          placeholder="Re-enter your new password"
          style={styles.field}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Update Password" onPress={handleSubmit} loading={submitting} style={styles.submitBtn} />
      </ScrollView>
      <Toast visible={toast.visible} message={toast.message} tone={toast.tone} onDone={() => setToast((t) => ({ ...t, visible: false }))} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  field: { marginBottom: spacing.base },
  error: { color: colors.red, fontSize: 12, marginBottom: spacing.sm },
  submitBtn: { marginTop: spacing.sm },
});
