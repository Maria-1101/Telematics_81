import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Image,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Dimensions,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Mappls, { MapView, Camera, PointAnnotation } from 'mappls-map-react-native';
import Geolocation from '@react-native-community/geolocation';
import database from '@react-native-firebase/database';

const { width, height } = Dimensions.get('window');

type RootStackParamList = {
  ExpandedMapView: {
    targetLocation: [number, number];
    locationData: {
      placeName: string;
      placeAddress: string;
    };
  };
};

type ExpandedRouteProp = RouteProp<RootStackParamList, 'ExpandedMapView'>;
type ExpandedNavigationProp = NativeStackNavigationProp<RootStackParamList, 'ExpandedMapView'>;

const buttonImages = [
  require('./assets/charging_stations.png'),
  require('./assets/find_my_device.png'),
  require('./assets/find_device_location.png'),
  require('./assets/current_location.png'),
];

export default function ExpandedMapView() {
  const navigation = useNavigation<ExpandedNavigationProp>();
  const route = useRoute<ExpandedRouteProp>();

  const { targetLocation, locationData } = route.params;
  const watchId = useRef<number | null>(null);

  const mapRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const [zoomLevel, setZoomLevel] = useState(17);

  const firebaseListenerRef = useRef<any>(null);
  const lastVehicleLocationRef = useRef<[number, number] | null>(null);

  const [loading, setLoading] = useState(false);
  const [deviceLocation, setDeviceLocation] = useState<[number, number] | null>(null);
  const [showDeviceMarker, setShowDeviceMarker] = useState(false);

  const [vehicleLocation, setVehicleLocation] = useState<[number, number]>(targetLocation);

  const onRegionDidChange = async () => {
    if (mapRef.current) {
      const zoom = await mapRef.current.getZoom();
      setZoomLevel(zoom);
    }
  };
  // Start Firebase ignition/location listener on demand (third button)
  const startVehicleLocationListener = () => {
    if (firebaseListenerRef.current) return; // Already listening

    setLoading(true);
    const dbRef = database().ref('/HomeFragment');
    firebaseListenerRef.current = dbRef;

    const onData = (snapshot: any) => {
      const data = snapshot.val();
      const lat = data?.Latitude;
      const lng = data?.Longitude;
      const ignition = data?.IgnitionStatus;

      if (typeof lat === 'number' && typeof lng === 'number') {
        if (ignition === 1) {
          // Ignition ON - update location continuously
          lastVehicleLocationRef.current = [lng, lat];
          setVehicleLocation([lng, lat]);
        } else if (ignition === 0) {
          // Ignition OFF - freeze location at last known update
          if (lastVehicleLocationRef.current) {
            setVehicleLocation(lastVehicleLocationRef.current);
          } else {
            // If no last location, assume current reading
            lastVehicleLocationRef.current = [lng, lat];
            setVehicleLocation([lng, lat]);
          }
        }
      }
      setLoading(false);
    };

    dbRef.on('value', onData, (error: any) => {
      setLoading(false);
      Alert.alert('Firebase Error', error.message);
    });
  };

  // Stop Firebase vehicle location listener
  const stopVehicleLocationListener = () => {
    if (firebaseListenerRef.current) {
      firebaseListenerRef.current.off();
      firebaseListenerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopVehicleLocationListener();
    };
  }, []);

  // Center map when vehicle location updates
  useEffect(() => {
    if (vehicleLocation && cameraRef.current) {
      cameraRef.current.setCamera({
        centerCoordinate: vehicleLocation,
        zoom: 17,
        animationDuration: 1000,
      });
    }
  }, [vehicleLocation]);

  // Handlers for buttons
  const onButtonPress = (index: number) => {
    if (index === 2) {
      // Third button: toggle ignition listener
      if (firebaseListenerRef.current) {
        stopVehicleLocationListener();
        Alert.alert('Stopped listening to vehicle location');
      } else {
        startVehicleLocationListener();
        Alert.alert('Started listening to vehicle location based on ignition status');
      }
    }
    if (index === 3) {
      // Fourth button: GPS device location fetch
      startWatchingDeviceLocation();
    }
  };
  
  async function requestLocationPermission() {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'App needs location permission to track location',
          buttonPositive: 'OK',
          buttonNegative: 'Cancel',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  }

   async function startWatchingDeviceLocation() {
    const hasPermission = await requestLocationPermission();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Location permission is required.');
      return;
    }
    setLoading(true);
    Geolocation.getCurrentPosition(
      (pos) => {
        const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        setDeviceLocation(coords);
        setShowDeviceMarker(true);
        setLoading(false);
        if (cameraRef.current) {
          cameraRef.current.setCamera({
            centerCoordinate: coords,
            zoom: 17,
            animationDuration: 1000,
          });
        }
      },
      (error) => {
        setLoading(false);
        Alert.alert('Location Error', error.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000,
      }
    );
  }

  useEffect(() => {
    return () => {
      if (watchId.current !== null) {
        Geolocation.clearWatch(watchId.current);
      }
    };
  }, []);

  const focusVehicle = () => {
    if (cameraRef.current) {
      cameraRef.current.setCamera({
        centerCoordinate: targetLocation,
        zoom: 17,
        animationDuration: 1000,
      });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <MapView
        style={{ width, height }}
        ref={mapRef}
        logoEnabled={false}
        attributionEnabled={false}
        onRegionDidChange={onRegionDidChange}
      >
        <Camera
          ref={cameraRef}
          centerCoordinate={targetLocation}
          zoomLevel={17}
          minZoomLevel={4}
          maxZoomLevel={22}
        />

        {/* Vehicle marker */}
        <PointAnnotation id="vehicle" coordinate={targetLocation}>
          <View style={styles.vehicleMarker}>
            <View style={styles.vehicleInner} />
          </View>
        </PointAnnotation>

        {/* Device GPS marker */}
        {showDeviceMarker && deviceLocation && (
          <PointAnnotation 
            id="device" 
            key={`device-location-${zoomLevel}`} 
            coordinate={deviceLocation}>
            <View style={styles.deviceMarker}>
              <View style={styles.deviceInner} />
            </View>
          </PointAnnotation>
        )}
      </MapView>

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      )}

      <View style={styles.buttonsContainer}>
        {buttonImages.map((imgSrc, idx) => (
          <TouchableOpacity key={idx} style={styles.button} onPress={() => onButtonPress(idx)}>
            <Image source={imgSrc} style={styles.buttonImage} />
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  vehicleMarker: {
    width: 28,
    height: 28,
    backgroundColor: 'rgba(255, 59, 48, 0.4)',
    borderRadius: 14,
    borderWidth: 3,
    borderColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  vehicleInner: {
    width: 14,
    height: 14,
    backgroundColor: '#FF3B30',
    borderRadius: 7,
  },
  deviceMarker: {
    width: 28,
    height: 28,
    backgroundColor: 'rgba(0, 122, 255, 0.4)',
    borderRadius: 14,
    borderWidth: 3,
    borderColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deviceInner: {
    width: 14,
    height: 14,
    backgroundColor: '#007AFF',
    borderRadius: 7,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  buttonsContainer: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    flexDirection: 'column',
    gap: 15,
  },
  button: {
    width: 60,
    height: 60,
    marginBottom: 12,
  },
  buttonImage: {
    width: 60,
    height: 60,
  },
});
