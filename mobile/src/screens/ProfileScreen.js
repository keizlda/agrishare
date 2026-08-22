import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Pill from "../components/Pill";
import { colors, radius } from "../theme";
import { useAuth } from "../context/AuthContext";

export default function ProfileScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { farmer } = useAuth();

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={18} color={colors.text} />
        </TouchableOpacity>
        <Ionicons name="person-outline" size={16} color={colors.primaryDark} />
        <Text style={styles.headerTitle}>My Profile</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={30} color={colors.primaryDark} />
          </View>
          <Text style={styles.name}>{farmer?.firstName} {farmer?.lastName}</Text>
          <Text style={styles.subtitle}>Farmer · {farmer?.farmerId}</Text>
          <Pill status={farmer?.validationStatus} />
        </View>

        <Card title="Personal Information" icon="id-card-outline">
          <Row label="RSBSA Number" value={farmer?.rsbsaNo} />
          <Row label="Barangay" value={farmer?.barangay} />
          <Row label="Contact Number" value={farmer?.contactNo} />
        </Card>

        <Card title="Farming Information" icon="leaf-outline">
          <Row label="Farm Size" value={farmer?.farmSize} />
          <Row label="Primary Commodity" value={farmer?.primaryCommodity} last />
        </Card>

        <Text style={styles.note}>
          To update your profile information, please coordinate with your FA President or the Municipal Agriculture Office.
        </Text>
      </ScrollView>
    </View>
  );
}

function Card({ title, icon, children }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name={icon} size={14} color={colors.primaryDark} />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Row({ label, value, last }) {
  return (
    <View style={[styles.row, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 14.5, fontWeight: "700", color: colors.text },
  content: { padding: 16, paddingBottom: 32 },

  avatarWrap: { alignItems: "center", marginBottom: 20 },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  name: { fontSize: 16, fontWeight: "800", color: colors.text },
  subtitle: { fontSize: 11.5, color: colors.textMuted, marginBottom: 8 },

  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  cardTitle: { fontSize: 12.5, fontWeight: "700", color: colors.text },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLabel: { fontSize: 11.5, color: colors.textMuted },
  rowValue: { fontSize: 12.5, color: colors.text, fontWeight: "600" },

  note: { fontSize: 10.5, color: colors.textMuted, textAlign: "center", marginTop: 8, lineHeight: 15 },
});
