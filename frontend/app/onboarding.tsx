import { OnboardingSlider } from "@/components/onboarding-slider";
import { useInstallOnboarding } from "@/context/install-onboarding";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

export default function Onboarding() {
  const intro = useInstallOnboarding();
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
      void intro.complete();
    }
  };

  const handleGetStarted = () => {
    setCurrentSlide(1);
  };

  const handleLetsGo = () => {
    void intro.complete();
  };

  return (
    <View style={styles.container}>
      <OnboardingSlider
        error={intro.error}
        saving={intro.saving}
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
