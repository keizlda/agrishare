import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radii, sizes, spacing, typography } from "../../theme";

// Same border color/radius as web's .form-control, with a real focus-ring
// treatment (RN has no CSS outline) using the app's global focus color —
// web/src/theme.css:45-53's `outline: 2px solid var(--agri-primary)`.
// Taller than web's default (48px vs Bootstrap's ~38px) per the touch-target
// rule. Number fields use keyboardType, never a stepper — RN TextInput has
// no native steppers to begin with.
export default function Input({ label, value, onChangeText, multiline, height, style, inputStyle, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={style}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        style={[
          styles.input,
          multiline ? { height: height ?? 90, textAlignVertical: "top", paddingTop: spacing.sm } : { height: sizes.inputHeight },
          focused && styles.focused,
          inputStyle,
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.textFaint}
        multiline={multiline}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: typography.label.fontSize, fontWeight: typography.label.fontWeight, color: colors.textSecondary, marginBottom: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    fontSize: typography.body.fontSize,
    color: colors.text,
    backgroundColor: colors.card,
  },
  focused: { borderColor: colors.primary, borderWidth: 1.5 },
});
