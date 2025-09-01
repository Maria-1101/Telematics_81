import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import database from '@react-native-firebase/database';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Mappls, { MapView, Camera, PointAnnotation } from 'mappls-map-react-native';

const MAPS_KEY = '20b2c7a2d61fa8e3c0f04cc4c3f5cbb3';
const REST_KEY = '20b2c7a2d61fa8e3c0f04cc4c3f5cbb3';
const ATLAS_CLIENT_ID = '96dHZVzsAutlN8qj9sy53VREgcqL_Jay_di_SlZqMU9CrjLwBKi3QXEhvpVYjLVApcz9pgEP3F0oKG6RZPeJpg==';
const ATLAS_CLIENT_SECRET = 'lrFxI-iSEg_-U93zuGixRT6C7rUG8EkIkVqGlKPN-JclhattubOfSgbl1MrbSLNxzpMfghG_-3sEPJp7r_9iMcCeuGUjYucg';

// Initialize SDK Keys on app start
Mappls.setMapSDKKey(MAPS_KEY);
Mappls.setRestAPIKey(REST_KEY);
Mappls.setAtlasClientId(ATLAS_CLIENT_ID);
Mappls.setAtlasClientSecret(ATLAS_CLIENT_SECRET);

interface LocationInfo {
  placeName: string;
  placeAddress: string;
}

interface LocationInfo {
  placeName: string;
  placeAddress: string;
}

type RootStackParamList = {
  MainScreen: undefined;
  ExpandedMapView: {
    targetLocation: [number, number];
    locationData: {
      placeName: string;
      placeAddress: string;
    };
  };
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'MainScreen'>;

export default function App() {
  const mapRef = useRef<React.ElementRef<typeof MapView>>(null);
  const cameraRef = useRef<React.ElementRef<typeof Camera>>(null);
  const navigation = useNavigation<NavigationProp>();

  const lastLocationRef = useRef<[number, number] | null>(null);
  const [latestIgnition, setLatestIgnition] = useState<number | null>(null);

  const [locationFromDB, setLocationFromDB] = useState<[number, number] | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [locationInfo, setLocationInfo] = useState<LocationInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [debugInfo, setDebugInfo] = useState<string>('Starting...');

  // Enhanced logging function
  const logDebug = (message: string, data?: any) => {
    console.warn(`[DEBUG] ${message}`, data ? JSON.stringify(data) : '');
    setDebugInfo(prev => `${prev}\n${new Date().toLocaleTimeString()}: ${message}`);
  };

  // POST request to fetch access token
  const fetchAccessToken = async (): Promise<string | null> => {
    try {
      logDebug('Starting access token fetch...');
      
      const response = await fetch('https://outpost.mappls.com/api/security/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `grant_type=client_credentials&client_id=${encodeURIComponent(
          ATLAS_CLIENT_ID,
        )}&client_secret=${encodeURIComponent(ATLAS_CLIENT_SECRET)}`,
      });

      logDebug(`Token response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        logDebug('Failed to fetch access token:', errorText);
        Alert.alert('Token Error', errorText);
        return null;
      }
      
      const json = await response.json();
      logDebug('Successfully fetched access token:', json);
      return json.access_token;
    } catch (e) {
      const error = e as Error;
      logDebug('Error fetching access token:', error);
      Alert.alert('Network Error', `Token fetch failed: ${error.message}`);
      return null;
    }
  };

  // Use nearby API to get exact building/place name using access token and lat, lon
  const fetchNearbyPlace = async (
    token: string,
    latitude: number,
    longitude: number,
  ): Promise<LocationInfo | null> => {
    try {
      const url = `https://atlas.mappls.com/api/places/nearby/json?keywords=office&refLocation=${latitude},${longitude}&radius=500`;
      
      logDebug('Requesting Mappls Nearby API...');
      logDebug(`URL: ${url}`);
      logDebug(`Using Access Token: ${token.substring(0, 20)}...`);
      logDebug(`Coordinates: Lat ${latitude}, Lng ${longitude}`);

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      logDebug(`Nearby API response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        logDebug('Failed to fetch nearby places:', errorText);
        Alert.alert('API Error', errorText);
        return null;
      }

      const json = await response.json();
      logDebug('Nearby API response received');
      logDebug('Response structure:', {
        hasResponse: !!json,
        hasSuggestedLocations: !!json?.suggestedLocations,
        locationsCount: json?.suggestedLocations?.length || 0
      });

      if (json?.suggestedLocations?.length) {
        const place = json.suggestedLocations[0];
        logDebug('Found place:', place);
        return {
          placeName: place.placeName || 'Unknown Place',
          placeAddress: place.placeAddress || 'Address not available',
        };
      } else {
        logDebug('No nearby places found in response');
        // Try with different keywords or no keywords
        return await fetchNearbyPlaceFallback(token, latitude, longitude);
      }
    } catch (e) {
      const error = e as Error;
      logDebug('Error in fetchNearbyPlace:', error);
      Alert.alert('Fetch Error', `Nearby places failed: ${error.message}`);
      return null;
    }
  };

  // Fallback method with different parameters
  const fetchNearbyPlaceFallback = async (
    token: string,
    latitude: number,
    longitude: number,
  ): Promise<LocationInfo | null> => {
    try {
      // Try without keywords
      const url = `https://atlas.mappls.com/api/places/nearby/json?refLocation=${latitude},${longitude}&radius=1000`;
      
      logDebug('Trying fallback nearby API without keywords...');

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const json = await response.json();
        logDebug('Fallback API response:', json);
        
        if (json?.suggestedLocations?.length) {
          const place = json.suggestedLocations[0];
          return {
            placeName: place.placeName || 'Nearby Location',
            placeAddress: place.placeAddress || 'Address not available',
          };
        }
      }
      
      // If still no results, return coordinate-based info
      return {
        placeName: 'Location',
        placeAddress: `Coordinates: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
      };
    } catch (e) {
      const error = e as Error;
      logDebug('Fallback also failed:', error);
      return null;
    }
  };

  // Firebase listener with enhanced debugging
  useEffect(() => {
    logDebug('Setting up Firebase listener...');

    const db = database();
    const dbRef = db.ref('/HomeFragment');

    const onData = (snapshot: any) => {
      logDebug('Firebase data received');
      const data = snapshot.val();
      logDebug('Firebase data:', data);

      const lat = Number(data?.Latitude);
      const lng = Number(data?.Longitude);
      const ignition = data?.IgnitionStatus;

      logDebug(`Latitude: ${lat} Longitude: ${lng}`);

      setLatestIgnition(ignition);

       if (!isNaN(lat) && !isNaN(lng)) {
        if (ignition === 1) {
          // Ignition ON: update location
          lastLocationRef.current = [lng, lat];          // Remember latest ON position
          setLocationFromDB([lng, lat]);
        } else if (ignition === 0) {
          // Ignition OFF: keep showing last ON location, do not update it again!
          if (lastLocationRef.current) {
            setLocationFromDB(lastLocationRef.current);
          } else {
            // App started and ignition is already OFF, treat this value as "last known"
            lastLocationRef.current = [lng, lat];
            setLocationFromDB([lng, lat]);
          }
        } else {
          logDebug('Unrecognized ignition status:', ignition);
          setLocationFromDB(null);
        }
      } else {
        logDebug('Invalid or missing coordinates in Firebase data');
        setLocationFromDB(null);
      }
    };

    dbRef.on('value', onData, (error: any) => {
      logDebug('Firebase error:', error);
      Alert.alert('Firebase Error', error.message);
    });

    return () => {
      logDebug('Cleaning up Firebase listener');
      dbRef.off('value', onData);
    };
  }, []);

  // Enhanced location info fetching
  useEffect(() => {
    const getInfo = async () => {
      logDebug('getInfo triggered', { locationFromDB, accessToken: !!accessToken });
      
      if (!locationFromDB) {
        logDebug('No location from DB, clearing location info');
        setLocationInfo(null);
        setLoading(false);
        return;
      }
      
      setLoading(true);
      logDebug('Starting location info fetch...');
      
      let token = accessToken;
      if (!token) {
        logDebug('No access token, fetching new one...');
        token = await fetchAccessToken();
        setAccessToken(token);
      }

      if (token) {
        logDebug('Have token, fetching nearby place...');
        const info = await fetchNearbyPlace(token, locationFromDB[1], locationFromDB[0]);
        logDebug('Nearby place result:', info);
        setLocationInfo(info);
      } else {
        logDebug('No token available, cannot fetch location info');
        Alert.alert('Error', 'Could not get access token');
      }
      
      setLoading(false);
    };
    
    getInfo();
  }, [locationFromDB]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      <View style={styles.infoBox}>
        {loading || locationInfo === null ? (
          <ActivityIndicator size="large" color="#007AFF" />
        ) : locationInfo ? (
          <>
            <Text style={styles.placeName}>{locationInfo.placeName}</Text>
            <Text style={styles.placeAddress}>{locationInfo.placeAddress}</Text>
            <Text style={styles.coordinates}>
              📍 {locationFromDB ? `${locationFromDB[1].toFixed(6)}° N, ${locationFromDB[0].toFixed(6)}° E` : ''}
            </Text>
          </>
        ) : (
          <Text style={styles.errorText}>Location info not available</Text>
        )}
      </View>

      {/* Only render map if locationFromDB is not null */}
      {locationFromDB && (
        <View style={styles.mapContainer}>
          <Text style={styles.debugCoords}>
            Map Center: {locationFromDB[1].toFixed(6)}, {locationFromDB[0].toFixed(6)}
          </Text>
          <MapView ref={mapRef} style={styles.map}>
            <Camera
              ref={cameraRef}
              centerCoordinate={locationFromDB}
              zoomLevel={15}
              minZoomLevel={4}
              maxZoomLevel={20}
            />
            <PointAnnotation 
              id="currentLocation" 
              coordinate={locationFromDB}
            >
              <View style={styles.marker}>
                <View style={styles.markerDot} />
              </View>
            </PointAnnotation>
          </MapView>
          <TouchableOpacity
            style={styles.imageButton}
            onPress={() => {
              console.log('Enlarge button pressed!');
              console.log('locationFromDB:', locationFromDB);
              console.log('locationInfo:', locationInfo);
              
              if (locationFromDB && locationInfo) {
                console.log('Navigating to ExpandedMapView with:', {
                  targetLocation: locationFromDB,
                  locationData: locationInfo,
                });
                
                navigation.navigate('ExpandedMapView', {
                  targetLocation: locationFromDB,
                  locationData: locationInfo,
                });
              } else {
                console.log('Location data not available yet');
                Alert.alert('Location data not available yet');
              }
            }}
          >
            <Image
              source={require('./assets/enlarge.png')}
              style={styles.imageIcon}
            />
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  infoBox: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: '#f9f9f9',
    borderBottomWidth: 1,
    borderColor: '#ddd',
  },
  placeName: { fontSize: 20, fontWeight: 'bold', color: '#222' },
  placeAddress: { fontSize: 14, color: '#555', marginTop: 4 },
  coordinates: { marginTop: 4, fontSize: 12, color: '#999' },
  errorText: { color: 'red', fontSize: 16, textAlign: 'center' },
  mapContainer: { 
    height: 210,
    width: '95%',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#e5e5e5',
    marginVertical: 12,
    alignSelf: 'center',
  },
  map: { flex: 1 },
  marker: {
    width: 24,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderColor: '#ec3030ff',
    borderWidth: 2,
    shadowColor: '#ff0000ff',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  markerDot: {
    width: 12,
    height: 12,
    backgroundColor: '#FF4444',
    borderRadius: 6,
  },
  debugCoords: {
    position: 'absolute',
    top: 5,
    left: 5,
    backgroundColor: 'rgba(0,0,0,0.7)',
    color: 'white',
    padding: 4,
    fontSize: 10,
    borderRadius: 3,
    zIndex: 1,
  },
  imageButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 10,
    width: 40,
    height: 40,
    opacity: 1,
  },
  imageIcon: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
    opacity: 0.9,
  },
});

