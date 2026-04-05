const { Client } = require("@googlemaps/google-maps-services-js");

const client = new Client({});

async function getNearbyVets(location) {
  try {
    const response = await client.textSearch({
      params: {
        query: `veterinary clinic in ${location}`,
        key: process.env.GOOGLE_MAPS_API_KEY,
      },
    });

    console.log("FULL GOOGLE RESPONSE:", JSON.stringify(response.data.results[0], null, 2));

const results = response.data.results.slice(0, 3);

    return results.map(place => ({
      name: place.name,
      rating: place.rating || "N/A",
      address: place.formatted_address,
      link: `maps.google.com/?q=${encodeURIComponent(place.name + " " + place.formatted_address)}`,
    }));

  } catch (error) {
    console.error("Maps error:", error.message);
    return [];
  }
}

module.exports = getNearbyVets;