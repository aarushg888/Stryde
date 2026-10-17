import React, { useState } from 'react';
import { Image, StyleSheet, View, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing, Colors } from '@/constants/theme';
import { useColorScheme } from 'react-native';
import { api, type Detection } from '@/api/api';

type HazardType = 'Sidewalk' | 'Tree' | 'Construction' | 'Other';

export default function HazardsScreen() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  // Form State Management
  const [selectedType, setSelectedType] = useState<HazardType | null>(null);
  const [locationText, setLocationText] = useState('');
  const [description, setDescription] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [detections, setDetections] = useState<Detection[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const handleAttachPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to attach evidence.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (!res.canceled && res.assets.length > 0) {
      setPhotoUri(res.assets[0].uri);
      setDetections(null);
    }
  };

  const handleSubmit = async () => {
    if (!selectedType || !locationText.trim()) {
      Alert.alert("Missing Information", "Please select a hazard type and specify the location.");
      return;
    }
    let found: Detection[] | null = null;
    if (photoUri) {
      setAnalyzing(true);
      try {
        found = (await api.detectHazard(photoUri)).detections;
        if (found.length === 0) {
          Alert.alert('Model result', 'No street barriers detected in this photo.');
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Detection failed';
        // model still training on Colab -> 503 "warming up": submit anyway
        Alert.alert('Detector unavailable', msg);
      } finally {
        setAnalyzing(false);
      }
    }
    setDetections(found);
    setIsSubmitted(true);
  };

  const handleResetForm = () => {
    setSelectedType(null);
    setLocationText('');
    setDescription('');
    setPhotoUri(null);
    setDetections(null);
    setIsSubmitted(false);
  };

  // Render Confirmation Screen when complete
  if (isSubmitted) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.confirmationContainer}>
          <ThemedText style={styles.successIcon}>✅</ThemedText>
          <ThemedText type="title" style={styles.title}>Hazard Reported!</ThemedText>
          <ThemedText style={styles.confirmationText}>
            Thank you for keeping Stryde safe. Your report has been pinned to the local network map.
          </ThemedText>
          {photoUri && <Image source={{ uri: photoUri }} style={styles.confirmPhoto} />}
          {detections !== null && (
            <ThemedText style={styles.confirmationText}>
              {detections.length > 0
                ? 'AI barriers detected: ' +
                  Object.entries(detections.reduce<Record<string, number>>((acc, d) => {
                    acc[d.class] = (acc[d.class] ?? 0) + 1;
                    return acc;
                  }, {})).map(([k, v]) => `${k}×${v}`).join(', ')
                : 'AI: no street barriers detected in the attached photo.'}
            </ThemedText>
          )}
          <TouchableOpacity 
            style={[styles.actionButton, { backgroundColor: '#3498db' }]} 
            onPress={handleResetForm}
          >
            <ThemedText style={styles.actionButtonText}>Report Another Hazard</ThemedText>
          </TouchableOpacity>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          
          {/* Header Block */}
          <View style={styles.header}>
            <ThemedText type="title" style={styles.title}>Report a Hazard</ThemedText>
            <ThemedText style={styles.subtitle}>Help your fellow pedestrians by logging street blocks or obstacles.</ThemedText>
          </View>

          {/* Section 1: Type Selection Matrix */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>1. Select Hazard Type</ThemedText>
            <View style={styles.matrixGrid}>
              {(['Sidewalk', 'Tree', 'Construction', 'Other'] as HazardType[]).map((type) => {
                const labelMap: Record<HazardType, string> = {
                  Sidewalk: '🚧 Blocked Sidewalk',
                  Tree: '🌳 Fallen Tree',
                  Construction: '🏗️ Construction',
                  Other: '⚠️ Other Obstacle',
                };
                const isSelected = selectedType === type;
                return (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.matrixItem,
                      { borderColor: colors.backgroundElement },
                      isSelected && styles.matrixItemSelected
                    ]}
                    onPress={() => setSelectedType(type)}
                    activeOpacity={0.7}
                  >
                    <ThemedText style={[styles.matrixText, isSelected && styles.matrixTextSelected]}>
                      {labelMap[type]}
                    </ThemedText>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Section 2: Location Information */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>2. Location Description</ThemedText>
            <TextInput
              style={[styles.inputField, { color: colors.text, borderColor: colors.backgroundElement }]}
              placeholder="e.g., 5th Ave and 23rd St, northeast corner"
              placeholderTextColor="#888"
              value={locationText}
              onChangeText={setLocationText}
            />
          </View>

          {/* Section 3: Extra Details */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>3. Additional Context (Optional)</ThemedText>
            <TextInput
              style={[styles.inputField, styles.textAreaField, { color: colors.text, borderColor: colors.backgroundElement }]}
              placeholder="Describe the issue (e.g. completely blocks strollers...)"
              placeholderTextColor="#888"
              multiline
              numberOfLines={3}
              value={description}
              onChangeText={setDescription}
            />
          </View>

          {/* Section 4: Photo attachment anchor */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>4. Visual Evidence</ThemedText>
            <TouchableOpacity 
              style={[styles.photoButton, { borderColor: photoUri ? '#2ecc71' : colors.backgroundElement }]}
              onPress={handleAttachPhoto}
              activeOpacity={0.7}
            >
              <ThemedText style={[styles.photoButtonText, photoUri && { color: '#2ecc71' }]}>
                {analyzing ? '🤖 Analyzing…' : photoUri ? '📸 Photo Attached ✓ — analyzing on submit' : '📷 Attach Photo'}
              </ThemedText>
            </TouchableOpacity>
          </View>

          {/* Main Action Submit Anchor */}
          <TouchableOpacity 
            style={[styles.actionButton, { backgroundColor: '#e74c3c' }]} 
            onPress={handleSubmit}
            activeOpacity={0.8}
          >
            <ThemedText style={styles.actionButtonText}>Submit Hazard Report</ThemedText>
          </TouchableOpacity>

        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  confirmPhoto: {
    width: '80%',
    height: 180,
    borderRadius: Spacing.three,
    marginBottom: Spacing.three,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    gap: Spacing.four,
  },
  header: {
    marginBottom: Spacing.two,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    marginBottom: Spacing.one,
  },
  subtitle: {
    fontSize: 15,
    opacity: 0.6,
    lineHeight: 20,
  },
  section: {
    gap: Spacing.two,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    opacity: 0.8,
  },
  matrixGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  matrixItem: {
    width: '48%',
    height: 50,
    borderWidth: 1,
    borderRadius: Spacing.two,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
    backgroundColor: 'rgba(0,0,0,0.01)',
  },
  matrixItemSelected: {
    backgroundColor: 'rgba(231, 76, 60, 0.1)',
    borderColor: '#e74c3c',
    borderWidth: 1.5,
  },
  matrixText: {
    fontSize: 13,
    fontWeight: '500',
  },
  matrixTextSelected: {
    color: '#e74c3c',
    fontWeight: '700',
  },
  inputField: {
    width: '100%',
    height: 44,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 14,
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  textAreaField: {
    height: 80,
    paddingTop: Spacing.two,
    textAlignVertical: 'top',
  },
  photoButton: {
    width: '100%',
    height: 48,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.01)',
  },
  photoButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  actionButton: {
    width: '100%',
    height: 48,
    borderRadius: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.two,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  confirmationContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.five,
    textAlign: 'center',
  },
  successIcon: {
    fontSize: 64,
    marginBottom: Spacing.three,
  },
  confirmationText: {
    fontSize: 15,
    textAlign: 'center',
    opacity: 0.7,
    lineHeight: 22,
    marginTop: Spacing.two,
    marginBottom: Spacing.four,
  },
});
