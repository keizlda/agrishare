import { useState } from "react";
import { TouchableOpacity } from "react-native";
import { Eye, EyeOff } from "lucide-react-native";
import Input from "./Input";
import { colors } from "../../theme";

// A password field with a show/hide (eye) button — the same icons as the
// login screen's.
export default function PasswordInput({ label, ...props }) {
  const [shown, setShown] = useState(false);
  return (
    <Input
      label={label}
      secureTextEntry={!shown}
      autoCapitalize="none"
      autoCorrect={false}
      right={
        <TouchableOpacity
          onPress={() => setShown((s) => !s)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${shown ? "Hide" : "Show"} ${label?.toLowerCase() ?? "password"}`}
        >
          {shown ? <EyeOff size={18} color={colors.textMuted} /> : <Eye size={18} color={colors.textMuted} />}
        </TouchableOpacity>
      }
      {...props}
    />
  );
}
