//fetchSecurityById
export const fetchSecurityById = async (securityId) => {
  const response = await fetch(`http://127.0.0.1:4001/info/${securityId}`);

  if (response.status === 404) {
    return { status: 404, error: `Security id ${securityId} not found` };
  }

  return await response.json();
};

export async function fetchSecurity(body) {
  let security = null;

  //access security-service to get security id
  if (body.securityId) {
    const data = await fetchSecurityById(body.securityId);

    if (data.error) {
      throw { status: data.status, error: data.error };
    }

    security = data;
    console.log("Security data:", data);

    //access security-service to get symbol
  } else if (body.symbol) {
    const symData = await fetch(
      `http://127.0.0.1:4001/search?symbol=${body.symbol}`,
    );

    let reply = await symData.json();
    security = reply.results[0];
    console.log("Symbol data present in security", reply);

    // if one symbol found
    if (reply.count === 1) {
      console.log(`Symbol ${reply.symbol} is the security`);
    }
    //if none
    else if (reply.count === 0) {
      console.log(`Symbol ${reply.symbol} not found`);
    }
    //if more than 1 symbol. Match with venue
    else if (reply.count > 1) {
      console.log(
        `Symbol ${reply.symbol} appears more than once. Match with venue`,
      );

      const venueMatch = reply.results.filter(
        (item) => item.venue === body.venue,
      );
      console.log("Venue Match:", venueMatch);
      if (venueMatch.length === 1) {
        security = venueMatch[0];
        console.log("Both symbol and venue match");
      } else {
        throw {
          status: 404,
          error: `Symbol ${reply.symbol} not found on venue ${body.venue}`,
        };
      }
    }
  }

  console.log("Final security:", security);
  return security;
}
