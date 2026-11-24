import { ScrollView, StyleSheet, View } from "react-native";
import ScreenHeader from "../components/ScreenHeader";
import PostCard from "../components/PostCard";
import { colors, spacing } from "../theme";

// One announcement in full, opened by tapping it on Home or in the
// Announcements list: the title, date / time / venue, all the details, the
// photo and who can see it. The caller marks it read.
export default function AnnouncementDetailScreen({ navigation, route }) {
  const post = route.params?.post;
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Announcement" onBack={() => navigation.goBack()} />
      {post && (
        <ScrollView contentContainerStyle={styles.content}>
          <PostCard post={post} full />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.base, paddingBottom: 48 },
});
