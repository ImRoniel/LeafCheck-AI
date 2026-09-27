import {
  DeviceConnectionScreen,
  deviceStyles as s,
} from "@/components/device-connection-screen";
import { useDeviceActivity } from "@/hooks/use-device-activity";
import { mockDeviceDelay } from "@/services/device-connection";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";

export default function DeviceScanner() {
  const router = useRouter();
  const active = useDeviceActivity();
  const controller = useRef<AbortController | null>(null);
  const [reduceMotion, setReduceMotion] = useState(true);
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted) setReduceMotion(value);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  useEffect(() => {
    if (!active || reduceMotion) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.2,
          duration: 850,
          useNativeDriver: Platform.OS !== "web",
          isInteraction: false,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 850,
          useNativeDriver: Platform.OS !== "web",
          isInteraction: false,
        }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
      pulse.setValue(1);
    };
  }, [active, pulse, reduceMotion]);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    controller.current = abort;
    void mockDeviceDelay(2400, abort.signal)
      .then(() => {
        if (!abort.signal.aborted)
          router.replace("/device-connection/selection");
      })
      .catch(() => {});
    return () => abort.abort();
  }, [active, router]);
  return (
    <DeviceConnectionScreen
      title="Finding your devices"
      step={1}
      onCancel={() => controller.current?.abort()}
    >
      <ScrollView contentContainerStyle={s.center}>
        <Animated.View
          accessible={false}
          style={{
            padding: 40,
            borderRadius: 100,
            backgroundColor: "#E8F2E8",
            transform: [{ scale: pulse }],
          }}
        >
          <Ionicons name="radio-outline" size={72} color="#193E27" />
        </Animated.View>
        <View>
          <Text accessibilityLiveRegion="polite" style={s.text}>
            Scanning for demo hardware nodes…
          </Text>
        </View>
        <Text style={s.text}>
          This simulated discovery takes a few seconds. Bluetooth and location
          permissions are not required.
        </Text>
      </ScrollView>
    </DeviceConnectionScreen>
  );
}
