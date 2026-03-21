# Project Instructions

## Overall Business Requirments
Create a webbased 1 and 1 chat tool which can be easily used via Mobile phone web browser. We will only allow 2 users. 

# featur 1 - login
When first time open the system, it will ask for an account -  Input email ID and nick name and group chat code, like (pass code) 
Hard code the passcode to 2013 at the backend.

# featur 2 - Group Chat window
The major part is a conversation canvas showing each user's diaglog and a send message conponent at the bottom. Each user messaged followed after user's icon or picture. We can scrolldown if many messages. it is always jump to the last message user have read. it will show how many new messages not read before user scroll to the bottom. like "20 new messages"

Show dateime of Each message. But we don't have to display timestap for every message, if current message sent 2 hours after previous message, show a date & time as a split before the message. The date display should be dynamic - follow this rule:  
if sent date is after 12:00 AM yesteday, then show "Today HH:MM" or "Yesterday HH:MM"; 
if ealier than that but within current week,  show weekday & time. e.g "Monday HH:MM", "Tueday HH:MM"

The entire tool theme can be switch between dark mode or like mode to support day and night reading habbit.

# Feature 3 - Supported message types

It supports text, picture, video message and emoji. and it supports 1 minute less Voice messgae. there is a button to switch for text message or Voice message. if switch to Voice, then hold the "Voice message" to record and then sent.

# Feature 4 - Message update/recall
The message can be updated within 10 minutes after sent, user can delete or recall the message.


# Feature 5 - Clean the message.
Any user can decide to clean the message for its device. but those messages are still stored in the backend data store.

# Feature 6 - message sent or read.
After new messages sent, show an eye icon to indicate the last message read by the user. read means if the message has been scrowd in the window.


# Feature 7 - allow search function
there is a seach icon, one click it, input the keyword, then it will search all messages revelant to that keywords. Click any of the item, the chat window will jump to that message part.

# Feature 8 - data sync
All data sync should happen transparently and backend. no feeling of enire page refreshed. As long as the page is open by the user, it should have second level data sync. If user switched to other apps, then no need any data sync.


## Task
- Provide an architecutre design
- provide a user front-end design in HTML.
- Create project plan with to do instruction