import { useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import ScreenHeader from "../components/ScreenHeader";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";
import { colors, spacing } from "../theme";
import { supabase } from "../lib/supabaseClient";

export default function ChangePasswordScreen({ navigation }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (newPassword.length < 6) {
      Alert.alert("Password too short", "Please use at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Passwords don't match", "Please re-enter your new password.");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      Alert.alert("Password updated", "Your password has been changed.");
      navigation.goBack();
    } catch (err) {
      Alert.alert("Couldn't update password", err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Change Password" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
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
        <Button label="Update Password" onPress={handleSubmit} loading={submitting} style={styles.submitBtn} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  field: { marginBottom: spacing.base },
  submitBtn: { marginTop: spacing.sm },
});
