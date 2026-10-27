import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import ScreenHeader from "../components/ScreenHeader";
import PasswordInput from "../components/ui/PasswordInput";
import Button from "../components/ui/Button";
import Toast from "../components/ui/Toast";
import { colors, spacing } from "../theme";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

// Same minimum as the web system's Change Password (web/src/pages/Settings.jsx).
const MIN_PASSWORD_LENGTH = 8;

export default function ChangePasswordScreen({ navigation }) {
  const { refreshFarmer } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: "", tone: "success" });

  function validate() {
    const found = {};
    if (!currentPassword) found.current = "Enter your current password.";
    if (!newPassword) found.new = "Enter a new password.";
    else if (newPassword.length < MIN_PASSWORD_LENGTH) found.new = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    else if (newPassword === currentPassword) found.new = "Use a password different from your current one.";
    if (!confirmPassword) found.confirm = "Re-enter your new password.";
    else if (confirmPassword !== newPassword) found.confirm = "Passwords don't match.";
    return found;
  }

  function clearError(field) {
    setErrors((e) => ({ ...e, [field]: undefined }));
  }

  async function handleSubmit() {
    const found = validate();
    setSubmitting(true);
    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;

      // The current password is checked even when another field has a
      // problem, so every error shows at once.
      if (currentPassword) {
        const { error: verifyErr } = await supabase.auth.signInWithPassword({
          email: userData.user.email,
          password: currentPassword,
        });
        if (verifyErr) found.current = "Your current password is incorrect.";
      }
      setErrors(found);
      if (Object.keys(found).length > 0) return;

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
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <PasswordInput
          label="Current Password"
          value={currentPassword}
          onChangeText={(v) => {
            setCurrentPassword(v);
            clearError("current");
          }}
          placeholder="Enter your current password"
          error={errors.current}
          style={styles.field}
        />
        <PasswordInput
          label="New Password"
          value={newPassword}
          onChangeText={(v) => {
            setNewPassword(v);
            clearError("new");
          }}
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          error={errors.new}
          style={styles.field}
        />
        <PasswordInput
          label="Confirm New Password"
          value={confirmPassword}
          onChangeText={(v) => {
            setConfirmPassword(v);
            clearError("confirm");
          }}
          placeholder="Re-enter your new password"
          error={errors.confirm}
          style={styles.field}
        />
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
  submitBtn: { marginTop: spacing.sm },
});
