import { OnboardingSlider } from "@/components/onboarding-slider";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

export default function Onboarding() {
  const router = useRouter();
  const [currentSlide, setCurrentSlide] = useState(0);

  const handlePrevious = () => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
    }
  };

  const handleNext = () => {
    if (currentSlide < 2) {
      setCurrentSlide(currentSlide + 1);
    } else {
      router.replace("/login");
    }
  };

  const handleGetStarted = () => {
    setCurrentSlide(1);
  };

  const handleLetsGo = () => {
    router.replace("/login");
  };

  return (
    <View style={styles.container}>
      <OnboardingSlider
        currentSlide={currentSlide}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onGetStarted={handleGetStarted}
        onLetsGo={handleLetsGo}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
