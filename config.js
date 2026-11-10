// Settings you may want to change. Everything else lives in js/.

// Free token from https://ion.cesium.com → Access Tokens.
export const CESIUM_ION_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6Ijd4QVUyWjJxNzlfTkhuQ0YiLCJqdGkiOiI5ZWEyMDJhNC0zMTI2LTRjN2EtYTYyYi1iNGM4ODcxNmYzMDMiLCJpZCI6NTQ2MzYyLCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3OTQzMDA5NTl9.7M8dGsgt8zK-3xZgrupme8w74cuYLIh_A0n4xagNb24";

// Optional: your own Google Maps Platform key with the Map Tiles API turned on.
// Leave it empty to stream Google's 3D tiles through Cesium ion instead.
export const GOOGLE_TILES_API_KEY = "";

// Places in the menu. Every flight starts at the first one.
// heading: compass degrees you face (0 = north). pitch: degrees up (+) or down (-).
// height: metres above sea level.
export const PLACES = [
  { name: "Manhattan", lat: 40.685, lon: -74.03, height: 300, heading: 24, pitch: -3 },
  { name: "Grand Canyon", lat: 36.057, lon: -112.14, height: 2300, heading: 30, pitch: -10 },
  { name: "Dubai", lat: 25.17, lon: 55.25, height: 450, heading: 39, pitch: 0 },
  { name: "Matterhorn", lat: 46.01, lon: 7.73, height: 3200, heading: 236, pitch: 5 },
  { name: "Rio de Janeiro", lat: -22.97, lon: -43.15, height: 400, heading: 290, pitch: -2 },
  { name: "Tokyo", lat: 35.63, lon: 139.76, height: 400, heading: 337, pitch: -2 },
  { name: "Edge of space", lat: 41.0, lon: 12.0, height: 60000, heading: 120, pitch: -15 },
];
