const log = ( message , type) => {
    //Get current date and hour and add it to the message
    const date = new Date()
    const formattedDate = date.toISOString().split('T')[0]
    const formattedHour = date.toTimeString().split(' ')[0]
    const formattedDateTime = `${formattedDate} ${formattedHour}`
    console.log(`[${formattedDateTime}] (${type}) ${message}`)
}

module.exports = {
    log
}