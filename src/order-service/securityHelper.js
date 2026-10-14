//fetchSecurityById
export const fetchSecurityById = async (securityId) => {
  const response = await fetch(`http://127.0.0.1:4001/info/${securityId}`);

  if (response.status === 404) {
    return { status: 404, error: `UNKNOWN_SECURITY` };
  }

  return await response.json();
};
//function to fetch security using securityId or symbol or symbol and venue
export async function fetchSecurity(body) {
  // try {
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
    //console.log("Symbol data present in security", reply);

    //if no symbol found
    if (reply.count === 0) {
      console.log(`Symbol ${reply.symbol} not found`);

      throw {
        status: 404,
        error: `UNKNOWN_SYMBOL`,
      };
    }
    // if one symbol found
    else if (reply.count === 1) {
      security = reply.results[0];
      console.log(`Symbol ${reply.symbol} is the security`);
    }
    //if more than 1 symbol. Match with venue
    else if (reply.count > 1) {
      console.log(
        `Symbol ${reply.symbol} appears more than once. Match with venue`,
      );
      //check if body conatins venue
      if (!body.venue) {
        throw { status: 422, error: "AMBIGUOUS_SYMBOL" };
      }
      //check if symbol given has a particular venue
      const venueMatch = reply.results.filter(
        (item) => item.venue === body.venue,
      );

      console.log("Venue Match:", venueMatch);
      if (venueMatch.length === 1) {
        security = venueMatch[0];
      }
      //if symbol and venue both are given but dont match
      else if (venueMatch.length === 0) {
        throw {
          status: 404,
          error: `SYMBOL_NOT_AT_VENUE`,
        };
      }
    }
    //If a venue was requested but the found security does not trade there then refuse it.
    if (body.venue && security.venue !== body.venue) {
      console.log(
        `${body.symbol} trades on ${security.venue} not requested ${body.venue}`,
      );
      throw { status: 404, error: `SYMBOL_NOT_AT_VENUE` };
    }
  }

  console.log("Final security:", security);

  return security;
}
