import { Client } from "@googlemaps/google-maps-services-js";

// Define function to get address components
export const locationFunctionTool = {
    name: "getAddressComponents",
    description: "Fetches address components for a given address.",
    parameters: {
      type: "object",
      properties: {
        address: { type: "string", description: "The full address to parse." },
      },
      required: ["address"],
    },
    call: async ({ address }) => {
      try {
        const gmaps = new Client({});
        const response = await gmaps.geocode({
          params: {
            address,
            key: process.env.MAP_KEY,
          },
        });
  
        if (response.data.results.length > 0) {
          const location = response.data.results[0].geometry.location;
          const address_components = response.data.results[0].address_components;
  
          const full_address = {
            address,
            lat: location.lat,
            lng: location.lng,
          };
  
          for (const component of address_components) {
            if (component.types.includes("locality")) {
              full_address["city"] = component.long_name;
            } else if (component.types.includes("administrative_area_level_1")) {
              full_address["state"] = component.long_name;
            } else if (component.types.includes("postal_code")) {
              full_address["postal_code"] = component.long_name;
            } else if (component.types.includes("country")) {
              full_address["country"] = component.long_name;
            }
          }
  
          return JSON.stringify(full_address);;
        } else {
          throw new Error("No results found for the given address.");
        }
      } catch (error) {
        console.error("Error fetching address components:", error);
        throw new Error("Geocoding failed. Ensure your API key is valid and the address is correct.");
      }
    },
    metadata: {
      name: "getAddressComponents",
      description: "A tool to fetch address details such as latitude, longitude, city, etc.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: "The full address to parse." },
        },
        required: ["address"],
      },
    },
  };
  