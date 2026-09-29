import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Dimensions, Image, Modal, PanResponder, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import { colors, radii } from "../theme";

const CIRCLE_SIZE = Math.min(Dimensions.get("window").width - 80, 320);
const MAX_ZOOM = 4;
const OUTPUT_SIZE = 512;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Max abs(translate) in screen px before the image's edge would show a gap
// inside the circle, for one axis — imgDim is that axis's natural pixel size.
function maxTranslateFor(imgDim, totalScale) {
  return Math.max(0, (imgDim * totalScale - CIRCLE_SIZE) / 2);
}

function touchDistance(touches) {
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

function snapshotTouches(touches) {
  return touches.map((t) => ({ x: t.pageX, y: t.pageY }));
}

// Full-screen "Adjust Photo" modal: drag-to-pan + pinch-to-zoom a photo
// behind a circular mask, then crops/resizes/compresses to a square avatar
// on confirm. Uses PanResponder + Animated (React Native core) rather than
// react-native-gesture-handler/reanimated — neither of those has a working
// native module in this Expo Go build (confirmed: both crash at startup
// with a native TurboModule/JNI error), so this sticks to APIs that ship
// unconditionally with every React Native app.
export default function AvatarCropModal({ visible, uri, onCancel, onConfirm }) {
  const [imgSize, setImgSize] = useState(null);
  const [processing, setProcessing] = useState(false);

  // Plain refs are the source of truth for gesture math (synchronous reads);
  // the Animated.Value pair just mirrors them for rendering.
  const posRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const lastTouchesRef = useRef(null);
  const lastPinchDistRef = useRef(null);
  const baseScaleRef = useRef(1);
  const imgSizeRef = useRef(null);

  const animX = useRef(new Animated.Value(0)).current;
  const animY = useRef(new Animated.Value(0)).current;
  const animScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible || !uri) return;
    setImgSize(null);
    posRef.current = { x: 0, y: 0 };
    scaleRef.current = 1;
    lastTouchesRef.current = null;
    lastPinchDistRef.current = null;
    animX.setValue(0);
    animY.setValue(0);
    animScale.setValue(1);
    Image.getSize(
      uri,
      (width, height) => {
        imgSizeRef.current = { width, height };
        baseScaleRef.current = CIRCLE_SIZE / Math.min(width, height);
        setImgSize({ width, height });
      },
      () => {
        const fallback = { width: CIRCLE_SIZE, height: CIRCLE_SIZE };
        imgSizeRef.current = fallback;
        baseScaleRef.current = 1;
        setImgSize(fallback);
      },
    );
  }, [visible, uri]);

  function clampPosition() {
    const img = imgSizeRef.current;
    if (!img) return;
    const totalScale = baseScaleRef.current * scaleRef.current;
    const maxX = maxTranslateFor(img.width, totalScale);
    const maxY = maxTranslateFor(img.height, totalScale);
    posRef.current = { x: clamp(posRef.current.x, -maxX, maxX), y: clamp(posRef.current.y, -maxY, maxY) };
    animX.setValue(posRef.current.x);
    animY.setValue(posRef.current.y);
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        lastTouchesRef.current = snapshotTouches(touches);
        lastPinchDistRef.current = touches.length === 2 ? touchDistance(touches) : null;
      },
      onPanResponderMove: (evt) => {
        if (!imgSizeRef.current) return;
        const touches = evt.nativeEvent.touches;
        const img = imgSizeRef.current;

        if (touches.length === 2) {
          const dist = touchDistance(touches);
          if (lastPinchDistRef.current != null) {
            const factor = dist / lastPinchDistRef.current;
            scaleRef.current = clamp(scaleRef.current * factor, 1, MAX_ZOOM);
            animScale.setValue(scaleRef.current);
            clampPosition();
          }
          lastPinchDistRef.current = dist;
          lastTouchesRef.current = snapshotTouches(touches);
        } else if (touches.length === 1) {
          lastPinchDistRef.current = null;
          if (lastTouchesRef.current && lastTouchesRef.current.length === 1) {
            const dx = touches[0].pageX - lastTouchesRef.current[0].x;
            const dy = touches[0].pageY - lastTouchesRef.current[0].y;
            const totalScale = baseScaleRef.current * scaleRef.current;
            const maxX = maxTranslateFor(img.width, totalScale);
            const maxY = maxTranslateFor(img.height, totalScale);
            posRef.current = {
              x: clamp(posRef.current.x + dx, -maxX, maxX),
              y: clamp(posRef.current.y + dy, -maxY, maxY),
            };
            animX.setValue(posRef.current.x);
            animY.setValue(posRef.current.y);
          }
          lastTouchesRef.current = snapshotTouches(touches);
        }
      },
      onPanResponderRelease: () => {
        lastTouchesRef.current = null;
        lastPinchDistRef.current = null;
      },
      onPanResponderTerminate: () => {
        lastTouchesRef.current = null;
        lastPinchDistRef.current = null;
      },
    }),
  ).current;

  async function handleUsePhoto() {
    if (!imgSize) return;
    setProcessing(true);
    try {
      const totalScale = baseScaleRef.current * scaleRef.current;
      const cropSize = CIRCLE_SIZE / totalScale;
      let originX = imgSize.width / 2 - CIRCLE_SIZE / (2 * totalScale) - posRef.current.x / totalScale;
      let originY = imgSize.height / 2 - CIRCLE_SIZE / (2 * totalScale) - posRef.current.y / totalScale;
      originX = clamp(originX, 0, Math.max(0, imgSize.width - cropSize));
      originY = clamp(originY, 0, Math.max(0, imgSize.height - cropSize));

      const result = await ImageManipulator.manipulateAsync(
        uri,
        [
          { crop: { originX, originY, width: cropSize, height: cropSize } },
          { resize: { width: OUTPUT_SIZE, height: OUTPUT_SIZE } },
        ],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
      );
      onConfirm(result.uri);
    } catch (err) {
      onConfirm(null, err);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.screen}>
        <Text style={styles.hint}>Drag and pinch to adjust</Text>

        <View style={styles.stage}>
          {imgSize ? (
            <View style={styles.circleWrap}>
              <View style={styles.circleClip} {...panResponder.panHandlers}>
                <Animated.Image
                  source={{ uri }}
                  style={{
                    width: imgSize.width,
                    height: imgSize.height,
                    transform: [{ translateX: animX }, { translateY: animY }, { scale: Animated.multiply(baseScaleRef.current, animScale) }],
                  }}
                  resizeMode="cover"
                />
              </View>
              <View style={styles.circleBorder} pointerEvents="none" />
            </View>
          ) : (
            <ActivityIndicator color="#fff" size="large" />
          )}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, styles.cancelBtn]} onPress={onCancel} disabled={processing}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.useBtn]} onPress={handleUsePhoto} disabled={processing || !imgSize}>
            {processing ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.useText}>Use Photo</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "space-between", paddingVertical: 48 },
  hint: { color: "#fff", fontSize: 14, fontWeight: "600", opacity: 0.85 },
  stage: { flex: 1, alignItems: "center", justifyContent: "center" },
  circleWrap: { width: CIRCLE_SIZE, height: CIRCLE_SIZE, alignItems: "center", justifyContent: "center" },
  circleClip: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111",
  },
  circleBorder: {
    position: "absolute",
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.85)",
  },
  actions: { flexDirection: "row", gap: 12, width: "100%", paddingHorizontal: 24 },
  btn: { flex: 1, height: 52, borderRadius: radii.sm, alignItems: "center", justifyContent: "center" },
  cancelBtn: { borderWidth: 1.5, borderColor: "rgba(255,255,255,0.6)" },
  cancelText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  useBtn: { backgroundColor: colors.primary },
  useText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
